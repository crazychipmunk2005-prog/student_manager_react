import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import DOMPurify from 'isomorphic-dompurify';
import validator from 'validator';
import 'dotenv/config';
import { logger, pruneOldLogs } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function deepSanitize(obj) {
  if (typeof obj === 'string') {
    return DOMPurify.sanitize(validator.escape(obj.trim()), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  if (typeof obj === 'object' && obj !== null) {
    const cleanObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const cleanKey = DOMPurify.sanitize(validator.escape(key.trim()), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
        cleanObj[cleanKey] = deepSanitize(obj[key]);
      }
    }
    return cleanObj;
  }
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return null;
    return obj;
  }
  if (typeof obj === 'boolean') return obj;
  return null;
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suspicious IP Tracker
// ─────────────────────────────────────────────────────────────────────────────

const suspiciousIPs = new Map(); // ip → { count4xx, totalReqs, firstSeen, flagged }

const SUSPICIOUS_THRESHOLDS = {
  max4xxIn5Min:   10,   // More than 10 client errors in 5 minutes → flag
  maxReqsIn1Min:  60,   // More than 60 requests in 1 minute → flag
  window5Min:     5 * 60 * 1000,
  window1Min:     60 * 1000,
};

const KNOWN_BAD_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nessus/i, /masscan/i, /zgrab/i, /burpsuite/i,
  /python-requests/i, /go-http-client/i, /curl\//i, /wget\//i,
  /scrapy/i, /httpclient/i, /libwww/i, /nmap/i,
];

function trackRequest(ip, statusCode) {
  const now = Date.now();
  if (!suspiciousIPs.has(ip)) {
    suspiciousIPs.set(ip, { count4xx: 0, totalReqs: 0, firstSeen: now, windowStart: now, flagged: false });
  }
  const record = suspiciousIPs.get(ip);

  // Reset window if expired
  if (now - record.windowStart > SUSPICIOUS_THRESHOLDS.window5Min) {
    record.count4xx = 0;
    record.totalReqs = 0;
    record.windowStart = now;
    record.flagged = false;
  }

  record.totalReqs++;
  if (statusCode >= 400 && statusCode < 500) record.count4xx++;

  // Check thresholds
  if (!record.flagged) {
    if (record.count4xx >= SUSPICIOUS_THRESHOLDS.max4xxIn5Min) {
      record.flagged = true;
      logger.suspicious('High 4xx rate detected', { ip, count4xx: record.count4xx, window: '5min' });
    }
    if (record.totalReqs >= SUSPICIOUS_THRESHOLDS.maxReqsIn1Min) {
      record.flagged = true;
      logger.suspicious('Unusually high request rate', { ip, totalReqs: record.totalReqs, window: '1min' });
    }
  }
}

function detectBotUA(ua) {
  if (!ua || ua.trim() === '') return 'missing-ua';
  for (const pattern of KNOWN_BAD_UA_PATTERNS) {
    if (pattern.test(ua)) return `matched-bad-ua: ${ua.slice(0, 80)}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// App Setup
// ─────────────────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';
const app = express();

// Trust first proxy (nginx, Firebase Hosting, Cloud Run, etc.)
app.set('trust proxy', 1);

// ─── HTTPS Enforcement ───────────────────────────────────────────────────────
// In production, redirect all plain HTTP requests to HTTPS
app.use((req, res, next) => {
  if (IS_PROD && req.protocol === 'http') {
    const httpsUrl = `https://${req.headers.host}${req.originalUrl}`;
    logger.security('HTTP request redirected to HTTPS', { ip: getClientIp(req), url: req.originalUrl });
    return res.redirect(301, httpsUrl);
  }
  next();
});

// ─── Helmet (Security Headers) ────────────────────────────────────────────────
app.use(helmet({
  hsts: {
    maxAge: 31536000,        // 1 year
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://firestore.googleapis.com', 'https://script.google.com'],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // Firebase SDK needs this off
}));

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin && !IS_PROD) return cb(null, true);
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    logger.security('CORS origin rejected', { origin });
    cb(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Session-Token'],
}));

app.use(express.json({ limit: '1mb' }));

// ─── Bot Detection Middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const botReason = detectBotUA(ua);

  if (botReason) {
    logger.suspicious('Bot/scanner detected', { ip, reason: botReason, path: req.path, method: req.method });
    // Don't block — log only (blocking can break legitimate tools)
  }

  // Flag path traversal attempts
  if (req.path.includes('..') || req.path.includes('%2e%2e') || req.path.includes('%2f')) {
    logger.security('Path traversal attempt', { ip, path: req.path });
    return res.status(400).json({ error: 'Invalid request path.' });
  }

  next();
});

// ─── Request Logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const ip = getClientIp(req);
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const meta = { ip, method: req.method, path: req.path, status: res.statusCode, ms: duration };

    // Track for suspicious pattern detection
    trackRequest(ip, res.statusCode);

    if (res.statusCode >= 500) {
      logger.error('Server error response', meta);
    } else if (res.statusCode >= 400) {
      logger.warn('Client error response', meta);
    } else {
      logger.info('Request', meta);
    }
  });

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiters
// ─────────────────────────────────────────────────────────────────────────────

function makeRateLimiter(options) {
  return rateLimit({
    ...options,
    handler: (req, res, next, opts) => {
      const ip = getClientIp(req);
      logger.auth('Rate limit hit', { ip, path: req.path, limit: opts.max, window: opts.windowMs });
      res.status(429).json({ error: opts.message.error });
    },
  });
}

const globalLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again later.' },
});

const loginLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const creationLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many account requests. Please try again in an hour.' },
});

const aiLimiter = makeRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: { error: 'Daily AI generation limit reached.' },
});

app.use('/api/', globalLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/signup', creationLimiter);
app.use('/api/generate', aiLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// CSRF Nonce (runtime-generated, not persisted — resets on server restart)
// ─────────────────────────────────────────────────────────────────────────────
const CSRF_TOKEN = randomUUID();

// ─────────────────────────────────────────────────────────────────────────────
// Server-side Session Store (in-memory, 8-hour expiry)
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_EXPIRY = 8 * 60 * 60 * 1000; // 8 hours
const BCRYPT_ROUNDS  = 12;
const sessions = new Map(); // token → { adminId, expiry }

function createSession(adminId) {
  const token  = randomUUID();
  const expiry = Date.now() + SESSION_EXPIRY;
  sessions.set(token, { adminId, expiry });
  return { token, expiry };
}

function validateSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiry) { sessions.delete(token); return null; }
  return sess;
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (now > sess.expiry) sessions.delete(token);
  }
}, 30 * 60 * 1000); // every 30 minutes

// ─────────────────────────────────────────────────────────────────────────────
// OTP Store (in-memory only — never written to disk)
// ─────────────────────────────────────────────────────────────────────────────
const otpStore    = new Map(); // email → { otpHash, expiry, attempts }
const resetTokens = new Map(); // token → { email, expiry }

const OTP_EXPIRY         = 5  * 60 * 1000; // 5 minutes
const RESET_EXPIRY       = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS   = 5;

function genOtp()   { return String(Math.floor(100000 + Math.random() * 900000)); }
function hashOtp(o) { return createHash('sha256').update(o).digest('hex'); }
function hashPw(p)  { return createHash('sha256').update(p).digest('hex'); }

function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token || token !== CSRF_TOKEN) {
    logger.security('CSRF token mismatch', { ip: getClientIp(req), path: req.path });
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Localhost-only guard for internal data endpoints
// These routes are never meant to be called directly from the public internet.
// ─────────────────────────────────────────────────────────────────────────────
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function requireLocalhost(req, res, next) {
  const ip = getClientIp(req);
  if (!LOCALHOST_IPS.has(ip)) {
    logger.security('External access attempt on internal endpoint', { ip, path: req.path });
    return res.status(403).json({ error: 'This endpoint is restricted to internal access only.' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Setup
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(process.cwd(), 'data', 'server_config.json');
const collections = ['admins', 'batches', 'students', 'activities', 'attendance', 'pendingUsers'];

// Block any direct HTTP access to /data/** at the route level (belt-and-suspenders)
app.use('/data', (req, res) => {
  logger.security('Direct data directory access attempt blocked', { ip: getClientIp(req), path: req.path });
  res.status(403).json({ error: 'Forbidden.' });
});

async function loadWebhookUrl() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.webhookUrl || process.env.WEBHOOK_URL || null;
  } catch {
    return process.env.WEBHOOK_URL || null;
  }
}

async function initDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const col of collections) {
    const filePath = path.join(DATA_DIR, `${col}.json`);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '[]', 'utf8');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/csrf-token — safe to call publicly, protected value is used as a request guard
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: CSRF_TOKEN });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth Endpoints (bcrypt server-side hashing)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/hash — hash a plaintext password with bcrypt (CSRF protected)
// Called during registration/password change. Password never stored on server.
app.post('/api/auth/hash', requireCsrf, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    res.json({ hash });
  } catch (err) {
    logger.error('bcrypt hash error', { error: err.message });
    res.status(500).json({ error: 'Hashing failed.' });
  }
});

// POST /api/auth/verify — verify password against bcrypt hash, return session token
// Called during login. Frontend sends plaintext + stored hash (read from Firestore).
const authVerifyLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts from this IP.' },
});
app.post('/api/auth/verify', requireCsrf, authVerifyLimiter, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { password, hash, adminId } = req.body || {};
    if (!password || !hash || !adminId) {
      return res.status(400).json({ error: 'password, hash and adminId are required.' });
    }
    // Detect legacy SHA-256 hash (64 hex chars) — still accept but flag for upgrade
    const isSha256 = /^[a-f0-9]{64}$/.test(hash);
    let match = false;
    if (isSha256) {
      // Legacy: compare SHA-256(password) against stored SHA-256 hash
      const sha = createHash('sha256').update(String(password)).digest('hex');
      match = (sha === hash);
    } else {
      match = await bcrypt.compare(String(password), hash);
    }
    if (!match) {
      logger.auth('Failed login attempt', { ip, adminId });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const session = createSession(adminId);
    logger.auth('Login successful', { ip, adminId, legacy: isSha256 });
    res.json({ success: true, sessionToken: session.token, sessionExpiry: session.expiry, needsUpgrade: isSha256 });
  } catch (err) {
    logger.error('Auth verify error', { error: err.message });
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

// POST /api/auth/logout — invalidate server-side session
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) sessions.delete(token);
  res.json({ success: true });
});

// GET /api/auth/check — verify session is still valid
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-session-token'];
  const sess  = validateSession(token);
  res.json({ valid: !!sess, expiry: sess?.expiry || null });
});


// GET /api/collection/:name — localhost only
app.get('/api/collection/:name', requireLocalhost, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const colName = req.params.name;
    if (!collections.includes(colName)) {
      logger.security('Invalid collection access attempt', { ip, colName });
      return res.status(400).json({ error: 'Invalid collection name.' });
    }
    const data = await fs.readFile(path.join(DATA_DIR, `${colName}.json`), 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    logger.error('Collection read error', { ip, error: error.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/sync — localhost only
app.post('/api/sync', requireLocalhost, async (req, res) => {
  const ip = getClientIp(req);
  try {
    if (!req.body || typeof req.body !== 'object') {
      logger.warn('Invalid sync payload', { ip });
      return res.status(400).json({ error: 'Invalid payload.' });
    }
    for (const col of collections) {
      if (req.body[col] !== undefined) {
        const sanitizedData = deepSanitize(req.body[col]);
        await fs.writeFile(
          path.join(DATA_DIR, `${col}.json`),
          JSON.stringify(sanitizedData, null, 2),
          'utf8'
        );
      }
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Sync error', { ip, error: error.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/database — localhost only
app.get('/api/database', requireLocalhost, async (req, res) => {
  const ip = getClientIp(req);
  const db = {};
  try {
    for (const col of collections) {
      const data = await fs.readFile(path.join(DATA_DIR, `${col}.json`), 'utf8');
      db[col] = JSON.parse(data);
    }
    res.json(db);
  } catch (error) {
    logger.error('Database read error', { ip, error: error.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/notify — CSRF protected
app.post('/api/notify', requireCsrf, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const webhookUrl = await loadWebhookUrl();
    if (!webhookUrl) {
      logger.warn('Notify called but webhook not configured', { ip });
      return res.status(503).json({ error: 'Notification service not configured on server.' });
    }

    const { username, email, adminEmail } = req.body || {};
    if (!username || !email) {
      return res.status(400).json({ error: 'Missing required fields: username and email.' });
    }

    const safeUsername  = DOMPurify.sanitize(validator.escape(String(username).trim()), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    const safeEmail     = validator.isEmail(String(email).trim()) ? validator.normalizeEmail(String(email).trim()) : null;
    const safeAdminEmail = adminEmail && validator.isEmail(String(adminEmail).trim())
      ? validator.normalizeEmail(String(adminEmail).trim())
      : process.env.ADMIN_EMAIL;

    if (!safeEmail) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    logger.auth('Signup notification dispatched', { ip, username: safeUsername });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: safeUsername, email: safeEmail, adminEmail: safeAdminEmail }),
    });

    if (!response.ok) {
      logger.error('Webhook delivery failed', { ip, status: response.status });
      return res.status(502).json({ error: 'Webhook delivery failed.' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Notify endpoint error', { ip, error: error.message });
    res.status(500).json({ error: 'Notification delivery failed.' });
  }
});

// PUT /api/webhook — CSRF protected (write-only: URL goes to server, never returned)
app.put('/api/webhook', requireCsrf, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { webhookUrl } = req.body || {};
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return res.status(400).json({ error: 'webhookUrl is required.' });
    }
    const trimmed = webhookUrl.trim();
    if (!validator.isURL(trimmed, { require_protocol: true, protocols: ['https'] })) {
      logger.warn('Invalid webhook URL submitted', { ip });
      return res.status(400).json({ error: 'Must be a valid HTTPS URL.' });
    }
    if (!trimmed.startsWith('https://script.google.com/')) {
      logger.security('Non-Google webhook URL rejected', { ip, url: trimmed.slice(0, 60) });
      return res.status(400).json({ error: 'Only Google Apps Script URLs are accepted.' });
    }

    let cfg = {};
    try { cfg = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')); } catch {}
    cfg.webhookUrl = trimmed;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    logger.security('Webhook URL updated by admin', { ip });
    res.json({ success: true });
  } catch (error) {
    logger.error('Webhook update error', { ip, error: error.message });
    res.status(500).json({ error: 'Failed to update webhook URL.' });
  }
});

// GET /api/webhook/status  (returns only true/false — never the URL)
app.get('/api/webhook/status', async (req, res) => {
  const url = await loadWebhookUrl();
  res.json({ configured: !!url });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password OTP Flow
// ─────────────────────────────────────────────────────────────────────────────

const forgotLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000, max: 3,
  message: { error: 'Too many password reset requests. Try again in an hour.' },
});

// Step 1 — Request OTP
app.post('/api/forgot-password', forgotLimiter, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { email } = req.body || {};
    if (!email || !validator.isEmail(String(email).trim())) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const safeEmail = validator.normalizeEmail(String(email).trim());

    // Generate OTP and store it — always, to prevent timing-based enumeration.
    // Real security: only the person who owns this inbox can read the code.
    const otp = genOtp();
    otpStore.set(safeEmail, { otpHash: hashOtp(otp), expiry: Date.now() + OTP_EXPIRY, attempts: 0 });

    const webhookUrl = await loadWebhookUrl();
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'otp_reset',
            targetEmail: safeEmail,
            otp,
            adminEmail: safeEmail,
          }),
        });
      } catch (e) {
        logger.error('OTP webhook delivery failed', { ip, error: e.message });
      }
    } else {
      // Dev fallback: print OTP to server console only (never to the client)
      logger.auth('DEV MODE — OTP (configure WEBHOOK_URL in .env):', { ip, otp });
    }

    logger.auth('OTP requested', { ip, email: safeEmail.replace(/.{3}/, '***') });

    // Always send the same response to prevent user enumeration
    res.json({ success: true, message: 'If this email is registered, a reset code has been sent.' });
  } catch (err) {
    logger.error('Forgot-password error', { ip, error: err.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Step 2 — Verify OTP → Issue reset token
app.post('/api/verify-otp', async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

    const safeEmail = validator.normalizeEmail(String(email).trim());
    const record    = otpStore.get(safeEmail);

    // Generic failure message to prevent oracle attacks
    const FAIL = { error: 'Invalid or expired OTP. Please request a new code.' };

    if (!record)                              return res.status(400).json(FAIL);
    if (Date.now() > record.expiry)           { otpStore.delete(safeEmail); return res.status(400).json(FAIL); }
    if (record.attempts >= OTP_MAX_ATTEMPTS)  { otpStore.delete(safeEmail); return res.status(400).json(FAIL); }

    record.attempts++;

    if (hashOtp(String(otp).trim()) !== record.otpHash) {
      logger.auth('Failed OTP attempt', { ip, attempts: record.attempts });
      return res.status(400).json(FAIL);
    }

    // OTP valid — invalidate it immediately (one-time use)
    otpStore.delete(safeEmail);

    // Issue a short-lived reset token
    const resetToken = randomUUID();
    resetTokens.set(resetToken, { email: safeEmail, expiry: Date.now() + RESET_EXPIRY });

    logger.auth('OTP verified, reset token issued', { ip, email: safeEmail.replace(/.{3}/, '***') });
    res.json({ success: true, resetToken });
  } catch (err) {
    logger.error('Verify-OTP error', { ip, error: err.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Step 3 — Apply new password
app.post('/api/reset-password', async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) return res.status(400).json({ error: 'Reset token and new password are required.' });

    const record = resetTokens.get(String(resetToken));
    if (!record || Date.now() > record.expiry) {
      resetTokens.delete(String(resetToken));
      return res.status(400).json({ error: 'Reset token is invalid or has expired.' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Invalidate the reset token immediately (one-time use)
    const { email } = record;
    resetTokens.delete(String(resetToken));

    // Hash the new password server-side (same SHA-256 as the frontend)
    const hashedPassword = hashPw(String(newPassword));

    logger.auth('Password reset completed', { ip, email: email.replace(/.{3}/, '***') });
    // Return the hashed password to the frontend to apply to the store + sync to Firestore
    res.json({ success: true, email, hashedPassword });
  } catch (err) {
    logger.error('Reset-password error', { ip, error: err.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────────────────────

// Catch any unhandled route
app.use((req, res) => {
  logger.warn('404 Not Found', { ip: getClientIp(req), method: req.method, path: req.path });
  res.status(404).json({ error: 'Not found.' });
});

// Catch any middleware/route errors
app.use((err, req, res, next) => {
  const ip = getClientIp(req);
  if (err.message?.startsWith('CORS policy')) {
    return res.status(403).json({ error: err.message });
  }
  logger.error('Unhandled server error', { ip, error: err.message, stack: IS_PROD ? undefined : err.stack });
  res.status(500).json({ error: 'Internal server error.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  await initDb();
  await pruneOldLogs();
  logger.info('Server started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  console.log(`\n✓ Student Manager backend running on port ${PORT}`);
  console.log(`  Mode   : ${IS_PROD ? 'PRODUCTION' : 'development'}`);
  console.log(`  Logs   : ./logs/\n`);
});

// Crash safety nets
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message });
  process.exit(1);
});

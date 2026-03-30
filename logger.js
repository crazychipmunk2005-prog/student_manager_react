/**
 * logger.js — Structured JSON logger for the student manager backend.
 *
 * Writes to two rotating daily log files:
 *   logs/app-YYYY-MM-DD.log      → info, warn, error
 *   logs/security-YYYY-MM-DD.log → auth, suspicious, security events
 *
 * Format: one JSON object per line (newline-delimited JSON / NDJSON).
 * Old logs (>7 days) are automatically pruned on startup.
 */

import { promises as fs, createWriteStream } from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');
const IS_DEV = process.env.NODE_ENV !== 'production';
const LOG_RETENTION_DAYS = 7;

// Ensure logs directory exists
await fs.mkdir(LOGS_DIR, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowISO() {
  return new Date().toISOString();
}

function logFilePath(type) {
  return path.join(LOGS_DIR, `${type}-${todayStamp()}.log`);
}

// Write a single NDJSON line to a file (append)
async function writeLine(filePath, obj) {
  try {
    await fs.appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
  } catch (e) {
    // Fallback: don't crash the server on log write failure
    console.error('[LOGGER] Failed to write log:', e.message);
  }
}

// ─── Log pruning (called on startup) ─────────────────────────────────────────

export async function pruneOldLogs() {
  try {
    const files = await fs.readdir(LOGS_DIR);
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(LOGS_DIR, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        console.log(`[LOGGER] Pruned old log: ${file}`);
      }
    }
  } catch (e) {
    console.warn('[LOGGER] Log pruning failed:', e.message);
  }
}

// ─── Core logger ─────────────────────────────────────────────────────────────

function buildEntry(level, message, meta = {}) {
  return { ts: nowISO(), level, message, ...meta };
}

async function log(level, message, meta = {}) {
  const entry = buildEntry(level, message, meta);
  const isSecurityEvent = ['auth', 'suspicious', 'security'].includes(level);
  const filePath = isSecurityEvent ? logFilePath('security') : logFilePath('app');

  await writeLine(filePath, entry);

  if (IS_DEV || level === 'error' || isSecurityEvent) {
    const prefix = {
      info:      '\x1b[36m[INFO]\x1b[0m',
      warn:      '\x1b[33m[WARN]\x1b[0m',
      error:     '\x1b[31m[ERROR]\x1b[0m',
      auth:      '\x1b[35m[AUTH]\x1b[0m',
      suspicious:'\x1b[41m[SUSPICIOUS]\x1b[0m',
      security:  '\x1b[41m[SECURITY]\x1b[0m',
    }[level] || '[LOG]';
    console.log(`${prefix} ${message}`, Object.keys(meta).length ? meta : '');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  info:      (msg, meta) => log('info',       msg, meta),
  warn:      (msg, meta) => log('warn',       msg, meta),
  error:     (msg, meta) => log('error',      msg, meta),
  auth:      (msg, meta) => log('auth',       msg, meta),
  suspicious:(msg, meta) => log('suspicious', msg, meta),
  security:  (msg, meta) => log('security',   msg, meta),
};

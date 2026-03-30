import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { sanitizeStrict, deepSanitize, hashPassword, hashSHA256 } from './utils';

// ============================================================
// Firebase config — loaded from environment variables only.
// Copy .env.example → .env and fill in your values.
// ============================================================
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app, db;
try {
  app = initializeApp(firebaseConfig);
  db  = getFirestore(app);
} catch (e) {
  console.error('Firebase App Initialization Error', e);
}

// ─── Firestore helpers ───────────────────────────────────────────────────────
const mainDocRef  = () => doc(db, 'student_manager', 'main_data');
const otpDocRef   = () => doc(db, 'student_manager', 'otp_requests');

// ─── Send email via Google Apps Script (fire-and-forget) ────────────────────
// Called directly from the browser — no server needed.
// GAS doesn't return CORS headers, so we use no-cors (can't read response).
export async function callWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',    // GAS doesn't support CORS — fire-and-forget
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('Webhook call failed (non-critical):', e.message);
  }
}

export const useStore = create(
  persist(
    (set, get) => ({
      admins:            [],
      batches:           [],
      students:          [],
      activities:        [],
      attendance:        [],
      currentUser:       null,
      adminEmail:        import.meta.env.VITE_ADMIN_EMAIL || '',
      webhookUrl:        import.meta.env.VITE_WEBHOOK_URL || '',  // seeded from env, updatable via Settings→Firestore
      pendingUsers:      [],
      isLoadedFromServer: false,
      sessionExpiry:     null, // 8-hour client-side session guard

      // ── Bootstrap from Firestore ────────────────────────────────────────
      loadFromServer: async () => {
        try {
          if (!db) return set({ isLoadedFromServer: true });
          const snap = await getDoc(mainDocRef());
          if (snap.exists()) {
            const d = snap.data();
            set({
              admins:       d.admins       || [],
              batches:      d.batches      || [],
              students:     d.students     || [],
              activities:   d.activities   || [],
              attendance:   d.attendance   || [],
              pendingUsers: d.pendingUsers || [],
              webhookUrl:   d.webhookUrl   || import.meta.env.VITE_WEBHOOK_URL || '',
              isLoadedFromServer: true,
            });
          } else {
            set({ isLoadedFromServer: true });
          }
        } catch (e) {
          console.error('Failed to connect to Firebase DB', e);
          alert('FIREBASE ERROR (READ): ' + e.message + '\n\nCheck your Firestore Rules!');
          set({ isLoadedFromServer: true });
        }
      },

      // ── Settings ────────────────────────────────────────────────────────
      setAdminEmail:  (email) => { try { set({ adminEmail: sanitizeStrict(email, 'email') }); } catch (e) { alert(e.message); } },
      setWebhookUrl:  (url)   => { try { set({ webhookUrl: sanitizeStrict(url, 'url') }); } catch (e) { alert(e.message); } },

      // ── Pending user signup ──────────────────────────────────────────────
      submitSignupRequest: async (username, email, password) => {
        try {
          const cUsername = sanitizeStrict(username, 'name');
          const cEmail    = sanitizeStrict(email, 'email');
          if (password.length < 8) throw new Error('Password must be at least 8 characters.');
          const pending_id = Date.now();
          const hPassword  = await hashPassword(password, String(pending_id));
          const { admins, pendingUsers } = get();
          if (admins.some(a => a.username === cUsername || a.email === cEmail)) return false;
          const filtered = pendingUsers.filter(p => p.email !== cEmail && p.username !== cUsername);
          set({ pendingUsers: [...filtered, { id: pending_id, username: cUsername, email: cEmail, password: hPassword }] });
          return true;
        } catch (e) { alert(e.message); return false; }
      },

      approveUser: (id) => {
        const { pendingUsers, admins, currentUser } = get();
        if (currentUser?.id !== 1) { alert('Only the main administrator can approve registrations.'); return; }
        const user = pendingUsers.find(u => u.id === id);
        if (user) set({ admins: [...admins, user], pendingUsers: pendingUsers.filter(u => u.id !== id) });
      },

      rejectUser: (id) => {
        const { pendingUsers, currentUser } = get();
        if (currentUser?.id !== 1) { alert('Only the main administrator can reject registrations.'); return; }
        set({ pendingUsers: pendingUsers.filter(u => u.id !== id) });
      },

      removeAdmin: (id) => {
        const { admins, currentUser } = get();
        if (currentUser?.id !== 1) { alert('Only the main administrator can remove other admins.'); return false; }
        if (id === 1 || id === currentUser?.id) return false;
        set({ admins: admins.filter(a => a.id !== id) });
        return true;
      },

      // ── Registration ────────────────────────────────────────────────────
      registerFirstAdmin: async (username, email, password) => {
        try {
          const cUsername = sanitizeStrict(username, 'name');
          const cEmail    = sanitizeStrict(email, 'email');
          if (password.length < 8) throw new Error('Password must be at least 8 characters.');
          const { admins } = get();
          if (admins.length > 0) return false;
          const hPassword = await hashPassword(password, '1'); // id is always 1 for first admin
          const newAdmin  = { id: 1, username: cUsername, email: cEmail, password: hPassword };
          set({ admins: [newAdmin], currentUser: { id: 1, username: cUsername, email: cEmail }, sessionExpiry: Date.now() + 8 * 3600 * 1000 });
          return true;
        } catch (e) { alert(e.message); return false; }
      },

      // ── Login ───────────────────────────────────────────────────────────
      login: async (identifier, password) => {
        try {
          const cId = sanitizeStrict(identifier, 'text');
          if (!password) return false;
          const { admins } = get();
          const admin = admins.find(a => a.username === cId || a.email === cId);
          if (!admin) return false;

          const storedHash = admin.password || '';

          // ① bcrypt (from previous server-era) — can't verify in browser → force reset
          if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
            alert('Your password was stored using a format that requires a reset.\nPlease use "Forgot Password" to set a new password.');
            return false;
          }

          // ② PBKDF2 (current format, prefix $pbkdf2$)
          if (storedHash.startsWith('$pbkdf2$')) {
            const hash = await hashPassword(password, String(admin.id));
            if (hash !== storedHash) return false;
          } else {
            // ③ Legacy SHA-256 (no prefix, 64 hex chars) — accept and silently upgrade
            const legacyHash = await hashSHA256(password);
            if (legacyHash !== storedHash) return false;
            // Upgrade to PBKDF2 in the background
            const newHash    = await hashPassword(password, String(admin.id));
            const upgraded   = admins.map(a => a.id === admin.id ? { ...a, password: newHash } : a);
            set({ admins: upgraded });
          }

          const { password: _pw, ...safeUser } = admin;
          set({ currentUser: safeUser, sessionExpiry: Date.now() + 8 * 3600 * 1000 });

          // Fire sign-in alert to admin email (fire-and-forget)
          const { webhookUrl } = get();
          callWebhook(webhookUrl, { type: 'sign_in_alert', username: admin.username, email: admin.email || '' });

          return true;
        } catch (e) { console.error(e); return false; }
      },

      forceLogin: (adminUser) => set({ currentUser: adminUser }),

      // ── Edit admin (IDOR: only self or main admin) ───────────────────────
      editAdmin: async (adminId, updatedAdminData) => {
        try {
          const { admins, currentUser } = get();
          const isSelf      = currentUser?.id === adminId;
          const isMainAdmin = currentUser?.id === 1;
          if (!isSelf && !isMainAdmin) { alert('You can only edit your own admin profile.'); return; }
          const safeData = deepSanitize(updatedAdminData);
          delete safeData.id;
          if (safeData.password && safeData.password.length >= 8) {
            safeData.password = await hashPassword(safeData.password, String(adminId));
          } else if (safeData.password && safeData.password.length > 0) {
            alert('Password must be at least 8 characters.'); return;
          } else {
            delete safeData.password;
          }
          const newAdmins = admins.map(a => a.id === adminId ? { ...a, ...safeData } : a);
          set({ admins: newAdmins });
          if (currentUser?.id === adminId) {
            const { password: _pw, ...safeUpdate } = safeData;
            set({ currentUser: { ...currentUser, ...safeUpdate } });
          }
        } catch (e) { alert(e.message); }
      },

      // ── Logout ──────────────────────────────────────────────────────────
      logout: () => set({ currentUser: null, sessionExpiry: null }),

      // ── Forgot Password — Firestore-based OTP flow ───────────────────────
      // Step 1: generate OTP → store hash in Firestore → email via Google Script
      requestPasswordReset: async (email) => {
        try {
          const safeEmail = email.toLowerCase().trim();
          const otp       = String(Math.floor(100000 + Math.random() * 900000));
          const otpHash   = await hashSHA256(otp); // SHA-256 of OTP is fine (short-lived, 5 min)
          const expiry    = Date.now() + 5 * 60 * 1000;
          const emailKey  = safeEmail.replace(/[.@+]/g, '_');

          if (!db) throw new Error('Firebase not available.');
          const snap    = await getDoc(otpDocRef());
          const current = snap.exists() ? snap.data() : {};
          await setDoc(otpDocRef(), { ...current, [emailKey]: { otpHash, expiry } });

          // Send OTP via Google Apps Script (fire-and-forget, no-cors)
          const { webhookUrl } = get();
          await callWebhook(webhookUrl, { type: 'otp_reset', targetEmail: safeEmail, otp, adminEmail: safeEmail });
          return true;
        } catch (e) { console.error(e); return false; }
      },

      // Step 2: verify OTP against Firestore hash
      verifyOtp: async (email, otp) => {
        try {
          const safeEmail = email.toLowerCase().trim();
          const emailKey  = safeEmail.replace(/[.@+]/g, '_');
          if (!db) return false;
          const snap = await getDoc(otpDocRef());
          if (!snap.exists()) return false;
          const record = snap.data()[emailKey];
          if (!record || Date.now() > record.expiry) return false;
          const inputHash = await hashSHA256(String(otp).trim());
          if (inputHash !== record.otpHash) return false;
          // Invalidate OTP immediately (one-time use)
          const updated = { ...snap.data() };
          delete updated[emailKey];
          await setDoc(otpDocRef(), updated);
          return true;
        } catch (e) { console.error(e); return false; }
      },

      // Step 3: apply new password after OTP verified
      applyPasswordReset: async (email, newPassword) => {
        try {
          const { admins } = get();
          const admin = admins.find(a => (a.email || '').toLowerCase() === email.toLowerCase().trim());
          if (!admin) return false;
          const hash      = await hashPassword(newPassword, String(admin.id));
          const newAdmins = admins.map(a => a.id === admin.id ? { ...a, password: hash } : a);
          set({ admins: newAdmins });
          return true;
        } catch (e) { console.error(e); return false; }
      },

      // ── Batch / Student / Activity / Attendance (unchanged) ─────────────
      addBatch: (name) => {
        try {
          const cName = sanitizeStrict(name, 'name');
          set((s) => ({ batches: [...s.batches, { id: Date.now(), name: cName }] }));
        } catch (e) { alert(e.message); }
      },
      deleteBatch: (id) => set((s) => {
        const actIds = s.activities.filter(a => a.batchId === id).map(a => a.id);
        return { batches: s.batches.filter(b => b.id !== id), students: s.students.filter(s => s.batchId !== id), activities: s.activities.filter(a => a.batchId !== id), attendance: s.attendance.filter(a => !actIds.includes(a.activityId)) };
      }),
      updateBatch: (updated) => { try { const s = deepSanitize(updated); if (s) set((st) => ({ batches: st.batches.map(b => b.id === s.id ? s : b) })); } catch (e) { alert(e.message); } },
      addStudent:    (student)  => { try { const s = deepSanitize(student);  if (s) set((st) => ({ students:    [...st.students,    { ...s, id: Date.now() }] })); } catch (e) { alert(e.message); } },
      updateStudent: (updated)  => { try { const s = deepSanitize(updated);  if (s) set((st) => ({ students:    st.students.map(x => x.id === s.id ? s : x) })); } catch (e) { alert(e.message); } },
      deleteStudent: (id) => set((s) => ({ students: s.students.filter(x => x.id !== id), attendance: s.attendance.filter(a => a.studentId !== id) })),
      addActivity:    (act)     => { try { const s = deepSanitize(act);      if (s) set((st) => ({ activities:  [...st.activities,  { ...s, id: Date.now() }] })); } catch (e) { alert(e.message); } },
      updateActivity: (updated) => { try { const s = deepSanitize(updated);  if (s) set((st) => ({ activities:  st.activities.map(x => x.id === s.id ? s : x) })); } catch (e) { alert(e.message); } },
      deleteActivity: (id) => set((s) => ({ activities: s.activities.filter(x => x.id !== id), attendance: s.attendance.filter(a => a.activityId !== id) })),
      saveAttendance: (activityId, records) => set((s) => ({ attendance: [...s.attendance.filter(a => a.activityId !== activityId), ...records] })),
      bulkImport: (newStudents, newActivities, newAttendance) => {
        try {
          const ss = deepSanitize(newStudents) || [], sa = deepSanitize(newActivities) || [], sat = deepSanitize(newAttendance) || [];
          set((state) => {
            const ids = [...new Set(sat.map(a => a.activityId))];
            return { students: [...state.students, ...ss], activities: [...state.activities, ...sa], attendance: [...state.attendance.filter(a => !ids.includes(a.activityId)), ...sat] };
          });
        } catch (e) { alert('Bulk import validation failed: ' + e.message); }
      },
    }),
    {
      name: 'student-manager-auth',
      partialize: (state) => ({
        // password hash is NEVER persisted — only safe public fields
        currentUser:   state.currentUser ? (({ password, ...rest }) => rest)(state.currentUser) : null,
        adminEmail:    state.adminEmail,
        sessionExpiry: state.sessionExpiry, // persisted to check on reload
        // webhookUrl intentionally excluded — loaded fresh from Firestore on boot
      }),
    }
  )
);

// ── Auto-sync all state changes to Firestore ────────────────────────────────
useStore.subscribe(async (state, prevState) => {
  if (!state.isLoadedFromServer) return;
  if (!prevState.isLoadedFromServer && state.isLoadedFromServer) return;

  const snapshot = {
    admins:       state.admins,
    batches:      state.batches,
    students:     state.students,
    activities:   state.activities,
    attendance:   state.attendance,
    pendingUsers: state.pendingUsers,
    webhookUrl:   state.webhookUrl,   // persisted in Firestore so it survives redeployment
  };

  try {
    if (!db) return;
    await setDoc(mainDocRef(), snapshot);
  } catch (error) {
    console.error('Failed to sync Firebase Database:', error);
    alert('FIREBASE SYNC ERROR: ' + error.message + '\n\nCheck your Firestore Rules!');
  }
});

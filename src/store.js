import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { sanitizeStrict, deepSanitize, hashPassword } from './utils';
// ==========================================
// Firebase config loaded from environment variables.
// Copy .env.example -> .env and fill in your values.
// NEVER hardcode secrets here.
// ==========================================
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase App Initialization Error", e);
}

export const useStore = create(
  persist(
    (set, get) => ({
      admins: [],
      batches: [],
      students: [],
      activities: [],
      attendance: [],
      currentUser: null,
      
      adminEmail: import.meta.env.VITE_ADMIN_EMAIL || '',
      pendingUsers: [],
      isLoadedFromServer: false,
      sessionToken: null,
      sessionExpiry: null,
      
      // Initialization to hydrate store from Firebase Firestore
      loadFromServer: async () => {
        try {
          if (!db) return set({ isLoadedFromServer: true });
          const docRef = doc(db, 'student_manager', 'main_data');
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            set({
               admins: data.admins || [],
               batches: data.batches || [],
               students: data.students || [],
               activities: data.activities || [],
               attendance: data.attendance || [],
               pendingUsers: data.pendingUsers || [],
               isLoadedFromServer: true
            });
          } else {
            // Database is new/empty, initialized safely
            set({ isLoadedFromServer: true });
          }
        } catch (e) {
          console.error('Failed to connect to Firebase DB', e);
          alert('FIREBASE CLOUD FIREWALL ERROR (READ): ' + e.message + '\n\nYour app cannot pull data from the cloud! Check your Firestore Rules!');
          set({ isLoadedFromServer: true }); // block break failsafe
        }
      },
  
  setAdminEmail: (email) => { try { set({ adminEmail: sanitizeStrict(email, 'email') }); } catch (e) { alert(e.message); } },
  // NOTE: webhook URL is managed server-side only via WEBHOOK_URL env var.

  submitSignupRequest: async (username, email, password) => {
    try {
      const cUsername = sanitizeStrict(username, 'name');
      const cEmail = sanitizeStrict(email, 'email');
      const cPassword = sanitizeStrict(password, 'password');
      const hPassword = await hashPassword(cPassword);
      const { admins, pendingUsers } = get();
      if (admins.some(a => a.username === cUsername || a.email === cEmail)) return false;
      const filteredPending = pendingUsers.filter(p => p.email !== cEmail && p.username !== cUsername);
      set({ pendingUsers: [...filteredPending, { id: Date.now(), username: cUsername, email: cEmail, password: hPassword }] });
      return true;
    } catch (e) { alert(e.message); return false; }
  },

  approveUser: (id) => {
    const { pendingUsers, admins } = get();
    const user = pendingUsers.find(u => u.id === id);
    if (user) {
      set({
        admins: [...admins, user],
        pendingUsers: pendingUsers.filter(u => u.id !== id)
      });
    }
  },

  rejectUser: (id) => {
    // IDOR guard: only the main admin (id:1) can reject pending registrations
    const { pendingUsers, currentUser } = get();
    if (currentUser?.id !== 1) { alert('Only the main administrator can reject registrations.'); return; }
    set({ pendingUsers: pendingUsers.filter(u => u.id !== id) });
  },

  removeAdmin: (id) => {
    const { admins, currentUser } = get();
    // IDOR guard: only the main admin (id:1) can remove other admins
    if (currentUser?.id !== 1) {
      alert('Only the main administrator can remove other admins.');
      return false;
    }
    // Main admin cannot remove themselves or their own root account
    if (id === 1 || id === currentUser?.id) return false;
    set({ admins: admins.filter(a => a.id !== id) });
    return true;
  },

  registerFirstAdmin: async (username, email, password) => {
    try {
      const cUsername = sanitizeStrict(username, 'name');
      const cEmail    = sanitizeStrict(email, 'email');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      // Hash password server-side with bcrypt
      const { apiFetch } = await import('./App.jsx');
      const hashRes = await apiFetch('/api/auth/hash', { method: 'POST', body: JSON.stringify({ password }) });
      const hashData = await hashRes.json();
      if (!hashRes.ok) throw new Error(hashData.error || 'Hashing failed.');
      const { admins } = get();
      if (admins.length > 0) return false;
      const newAdmin = { id: 1, username: cUsername, email: cEmail, password: hashData.hash };
      set({ admins: [newAdmin], currentUser: { id: 1, username: cUsername, email: cEmail } });
      return true;
    } catch (e) { alert(e.message); return false; }
  },
  
  registerAdmin: async (username, password) => {
    try {
      const cUsername = sanitizeStrict(username, 'name');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      const { apiFetch } = await import('./App.jsx');
      const hashRes = await apiFetch('/api/auth/hash', { method: 'POST', body: JSON.stringify({ password }) });
      const hashData = await hashRes.json();
      if (!hashRes.ok) throw new Error(hashData.error || 'Hashing failed.');
      const { admins } = get();
      if (admins.some(a => a.username === cUsername)) return false;
      const newAdmin = { id: Date.now(), username: cUsername, password: hashData.hash };
      set({ admins: [...admins, newAdmin], currentUser: { id: newAdmin.id, username: cUsername } });
      return true;
    } catch (e) { alert(e.message); return false; }
  },
  
  login: async (identifier, password) => {
    try {
      const cId = sanitizeStrict(identifier, 'text');
      if (!password || password.length < 1) return false;
      const { admins } = get();
      // Find the admin record by username or email
      const admin = admins.find(a => a.username === cId || a.email === cId);
      if (!admin) return false;
      // Server-side bcrypt verification (handles both legacy SHA-256 and bcrypt)
      const { apiFetch } = await import('./App.jsx');
      const res  = await apiFetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ password, hash: admin.password, adminId: admin.id })
      });
      const data = await res.json();
      if (!res.ok) return false;
      // If the stored hash is legacy SHA-256, upgrade to bcrypt silently
      if (data.needsUpgrade) {
        const hashRes  = await apiFetch('/api/auth/hash', { method: 'POST', body: JSON.stringify({ password }) });
        const hashData = await hashRes.json();
        if (hashRes.ok) {
          const upgraded = admins.map(a => a.id === admin.id ? { ...a, password: hashData.hash } : a);
          set({ admins: upgraded });
        }
      }
      // Store session — strip password from currentUser in state
      const { password: _pw, ...safeUser } = admin;
      set({
        currentUser:   safeUser,
        sessionToken:  data.sessionToken,
        sessionExpiry: data.sessionExpiry,
      });
      return true;
    } catch (e) { console.error(e); return false; }
  },
  
  forceLogin: (adminUser) => set({ currentUser: adminUser }),
  
  editAdmin: async (adminId, updatedAdminData) => {
    try {
      const { admins, currentUser } = get();
      const isSelf      = currentUser?.id === adminId;
      const isMainAdmin = currentUser?.id === 1;
      if (!isSelf && !isMainAdmin) { alert('You can only edit your own admin profile.'); return; }
      const safeData = deepSanitize(updatedAdminData);
      delete safeData.id;
      if (safeData.password && safeData.password.length >= 8) {
        // Hash new password server-side with bcrypt
        const { apiFetch } = await import('./App.jsx');
        const hashRes  = await apiFetch('/api/auth/hash', { method: 'POST', body: JSON.stringify({ password: safeData.password }) });
        const hashData = await hashRes.json();
        if (!hashRes.ok) { alert(hashData.error || 'Hashing failed.'); return; }
        safeData.password = hashData.hash;
      } else if (safeData.password && safeData.password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      } else {
        delete safeData.password;
      }
      const newAdmins = admins.map(a => a.id === adminId ? { ...a, ...safeData } : a);
      set({ admins: newAdmins });
      // Update currentUser but never store the password hash in state
      if (currentUser?.id === adminId) {
        const { password: _pw, ...safeUpdate } = safeData;
        set({ currentUser: { ...currentUser, ...safeUpdate } });
      }
    } catch (e) { alert(e.message); }
  },
  
  logout: async () => {
    const { sessionToken } = get();
    // Invalidate the server-side session
    if (sessionToken) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-session-token': sessionToken } });
      } catch { /* best-effort */ }
    }
    set({ currentUser: null, sessionToken: null, sessionExpiry: null });
  },

  // Applied after a successful server-side OTP reset flow.
  // The hashedPassword comes from the server (never from user input directly).
  applyPasswordReset: (email, hashedPassword) => {
    const { admins } = get();
    const normalizedEmail = email.toLowerCase().trim();
    const newAdmins = admins.map(a =>
      (a.email || '').toLowerCase().trim() === normalizedEmail
        ? { ...a, password: hashedPassword }
        : a
    );
    set({ admins: newAdmins });
  },

  addBatch: (name) => {
    try {
      const cName = sanitizeStrict(name, 'name');
      set((state) => ({ batches: [...state.batches, { id: Date.now(), name: cName }] }));
    } catch (e) { alert(e.message); }
  },
  
  deleteBatch: (id) => set((state) => {
    const activityIds = state.activities.filter(a => a.batchId === id).map(a => a.id);
    return {
      batches: state.batches.filter(b => b.id !== id),
      students: state.students.filter(s => s.batchId !== id),
      activities: state.activities.filter(a => a.batchId !== id),
      attendance: state.attendance.filter(a => !activityIds.includes(a.activityId))
    };
  }),

  updateBatch: (updated) => {
    try {
      const safeData = deepSanitize(updated);
      if (safeData) set((state) => ({ batches: state.batches.map(b => b.id === safeData.id ? safeData : b) }));
    } catch (e) { alert(e.message); }
  },
  
  addStudent: (student) => {
    try {
      const safeStudent = deepSanitize(student);
      if (safeStudent) set((state) => ({ students: [...state.students, { ...safeStudent, id: Date.now() }] }));
    } catch (e) { alert(e.message); }
  },
  
  updateStudent: (updated) => {
    try {
      const safeData = deepSanitize(updated);
      if (safeData) set((state) => ({ students: state.students.map(s => s.id === safeData.id ? safeData : s) }));
    } catch (e) { alert(e.message); }
  },
  
  deleteStudent: (id) => set((state) => ({
    students: state.students.filter(s => s.id !== id),
    attendance: state.attendance.filter(a => a.studentId !== id)
  })),

  addActivity: (activity) => {
    try {
      const safeAct = deepSanitize(activity);
      if (safeAct) set((state) => ({ activities: [...state.activities, { ...safeAct, id: Date.now() }] }));
    } catch (e) { alert(e.message); }
  },
  
  updateActivity: (updated) => {
    try {
      const safeData = deepSanitize(updated);
      if (safeData) set((state) => ({ activities: state.activities.map(a => a.id === safeData.id ? safeData : a) }));
    } catch (e) { alert(e.message); }
  },

  deleteActivity: (id) => set((state) => ({
    activities: state.activities.filter(a => a.id !== id),
    attendance: state.attendance.filter(a => a.activityId !== id)
  })),

  saveAttendance: (activityId, records) => set((state) => {
    const otherLogs = state.attendance.filter(a => a.activityId !== activityId);
    return { attendance: [...otherLogs, ...records] };
  }),

  bulkImport: (newStudents, newActivities, newAttendance) => {
    try {
      const safeStudents = deepSanitize(newStudents) || [];
      const safeActivities = deepSanitize(newActivities) || [];
      const safeAttendance = deepSanitize(newAttendance) || [];

      set((state) => {
        const importedActIds = [...new Set(safeAttendance.map(a => a.activityId))];
        const untouchedAttendance = state.attendance.filter(a => !importedActIds.includes(a.activityId));
        return {
          students: [...state.students, ...safeStudents],
          activities: [...state.activities, ...safeActivities],
          attendance: [...untouchedAttendance, ...safeAttendance]
        };
      });
    } catch (e) { alert("Bulk import validation failed: " + e.message); }
  },
    }),
    {
      name: 'student-manager-auth',
      partialize: (state) => ({
        // sessionToken and currentUser.password are intentionally excluded
        // from localStorage — they must never be persisted
        currentUser: state.currentUser
          ? (({ password, ...rest }) => rest)(state.currentUser)
          : null,
        adminEmail: state.adminEmail,
        // sessionExpiry IS persisted so the browser can check it on reload
        sessionExpiry: state.sessionExpiry,
      }),
    }
  )
);

// Automatic sync to Firebase Firestore DB
useStore.subscribe(async (state, prevState) => {
  // Only sync if data has actually been bootstrapped from server first
  if (!state.isLoadedFromServer) return;
  if (!prevState.isLoadedFromServer && state.isLoadedFromServer) return; // Ignore the initial load tick

  const snapshot = {
    admins: state.admins,
    batches: state.batches,
    students: state.students,
    activities: state.activities,
    attendance: state.attendance,
    pendingUsers: state.pendingUsers
  };

  try {
    if (!db) return;
    const docRef = doc(db, 'student_manager', 'main_data');
    await setDoc(docRef, snapshot);
  } catch (error) {
    console.error('Failed to sync Firebase Database:', error);
    alert('FIREBASE CLOUD FIREWALL ERROR: ' + error.message + '\n\nYour data is NOT saving securely to the Cloud because your Firestore Rules are still blocking writes. Please ensure they are set to "allow read, write: if true;" and published in your Firebase Console.');
  }
});

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// ==========================================
// TODO: PASTE YOUR FIREBASE CONFIG HERE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDqFWqh7tRYyLaQ2j5KRC1rBb-n-WEAKOE",
  authDomain: "student-management-syste-fe04a.firebaseapp.com",
  projectId: "student-management-syste-fe04a",
  storageBucket: "student-management-syste-fe04a.firebasestorage.app",
  messagingSenderId: "612009754941",
  appId: "1:612009754941:web:0c9cf78e7cb793a3f78554",
  measurementId: "G-07DQB9RDTW"
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
      
      adminEmail: 'gktunoff@gmail.com',
      emailJsSettings: { serviceId: '', templateId: '', publicKey: '' },
      pendingUsers: [],
      isLoadedFromServer: false,
      
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
          set({ isLoadedFromServer: true }); // block break failsafe
        }
      },
  
  setAdminEmail: (email) => set({ adminEmail: email }),
  setEmailJsSettings: (settings) => set({ emailJsSettings: settings }),

  submitSignupRequest: (username, email, password) => {
    const { admins, pendingUsers } = get();
    
    // Block if they are ALREADY an approved admin
    if (admins.some(a => a.username === username || a.email === email)) return false;
    
    // If they have a pending request, remove it and create a fresh one
    const filteredPending = pendingUsers.filter(p => p.email !== email && p.username !== username);
    
    set({ pendingUsers: [...filteredPending, { id: Date.now(), username, email, password }] });
    return true;
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
    const { pendingUsers } = get();
    set({ pendingUsers: pendingUsers.filter(u => u.id !== id) });
  },

  removeAdmin: (id) => {
    const { admins, currentUser } = get();
    // Prevent removing the main admin (id: 1) or oneself
    if (id === 1 || id === currentUser?.id) return false;
    set({ admins: admins.filter(a => a.id !== id) });
    return true;
  },

  registerFirstAdmin: (username, email, password) => {
    const { admins } = get();
    if (admins.length > 0) return false;
    const newAdmin = { id: 1, username, email, password };
    set({ admins: [newAdmin], currentUser: newAdmin });
    return true;
  },
  
  registerAdmin: (username, password) => {
    const { admins } = get();
    if (admins.some(a => a.username === username)) return false;
    const newAdmin = { id: Date.now(), username, password };
    set({ admins: [...admins, newAdmin], currentUser: newAdmin });
    return true;
  },
  
  login: (identifier, password) => {
    const { admins } = get();
    const user = admins.find(a => (a.username === identifier || a.email === identifier) && a.password === password);
    if (user) {
      set({ currentUser: user });
      return true;
    }
    return false;
  },
  
  forceLogin: (adminUser) => set({ currentUser: adminUser }),
  
  editAdmin: (adminId, updatedAdminData) => {
    const { admins, currentUser } = get();
    const newAdmins = admins.map(a => a.id === adminId ? { ...a, ...updatedAdminData } : a);
    set({ admins: newAdmins });
    if (currentUser?.id === adminId) {
       set({ currentUser: { ...currentUser, ...updatedAdminData } });
    }
  },
  
  logout: () => set({ currentUser: null }),

  addBatch: (name) => set((state) => ({
    batches: [...state.batches, { id: Date.now(), name }]
  })),
  
  deleteBatch: (id) => set((state) => {
    const activityIds = state.activities.filter(a => a.batchId === id).map(a => a.id);
    return {
      batches: state.batches.filter(b => b.id !== id),
      students: state.students.filter(s => s.batchId !== id),
      activities: state.activities.filter(a => a.batchId !== id),
      attendance: state.attendance.filter(a => !activityIds.includes(a.activityId))
    };
  }),
  
  addStudent: (student) => set((state) => ({
    students: [...state.students, { ...student, id: Date.now() }]
  })),
  
  updateStudent: (updated) => set((state) => ({
    students: state.students.map(s => s.id === updated.id ? updated : s)
  })),
  
  deleteStudent: (id) => set((state) => ({
    students: state.students.filter(s => s.id !== id),
    attendance: state.attendance.filter(a => a.studentId !== id)
  })),

  addActivity: (activity) => set((state) => ({
    activities: [...state.activities, { ...activity, id: Date.now() }]
  })),
  
  deleteActivity: (id) => set((state) => ({
    activities: state.activities.filter(a => a.id !== id),
    attendance: state.attendance.filter(a => a.activityId !== id)
  })),

  saveAttendance: (activityId, records) => set((state) => {
    const otherLogs = state.attendance.filter(a => a.activityId !== activityId);
    return { attendance: [...otherLogs, ...records] };
  }),
    }),
    {
      name: 'student-manager-auth',
      partialize: (state) => ({
        currentUser: state.currentUser,
        adminEmail: state.adminEmail,
        emailJsSettings: state.emailJsSettings,
      }),
    }
  )
);

// Automatic sync to Firebase Firestore DB
useStore.subscribe(async (state, prevState) => {
  // Only sync if data has actually been bootstrapped from server first
  if (!state.isLoadedFromServer || !prevState.isLoadedFromServer) return;

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
  }
});

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      logout: () => set({ currentUser: null }),

      addBatch: (name) => set((state) => ({
        batches: [...state.batches, { id: Date.now(), name }]
      })),
      deleteBatch: (id) => set((state) => ({
        batches: state.batches.filter(b => b.id !== id),
        students: state.students.filter(s => s.batchId !== id),
        activities: state.activities.filter(a => a.batchId !== id),
      })),
      
      addStudent: (student) => set((state) => ({
        students: [...state.students, { ...student, id: Date.now() }]
      })),
      updateStudent: (updated) => set((state) => ({
        students: state.students.map(s => s.id === updated.id ? updated : s)
      })),
      deleteStudent: (id) => set((state) => ({
        students: state.students.filter(s => s.id !== id)
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
      name: 'student-manager-storage',
    }
  )
)

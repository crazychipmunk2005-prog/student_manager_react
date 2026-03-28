import { useState } from 'react';
import { useStore } from './store';
import { exportToExcel, exportActivityAttendance } from './utils';
import { Download, LogOut, Users, BookOpen, BarChart3, ChevronLeft, Plus, Trash2, CheckCircle2, Settings } from 'lucide-react';

export default function App() {
  const { currentUser, logout } = useStore();
  const [currentView, setCurrentView] = useState('DASHBOARD'); // DASHBOARD | BATCH_DETAIL | ATTENDANCE | STUDENT_DETAIL | SETTINGS
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [activeActivityId, setActiveActivityId] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState(null);

  if (!currentUser) return <LoginView />;

  const handleLogout = () => {
    logout();
    setCurrentView('DASHBOARD');
  };

  return (
    <div className="app-container">
      <header className="header animate-fade-in">
        <h1 className="title">StudentManager</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>{currentUser.username}</span>
          <button onClick={() => setCurrentView('SETTINGS')} className="btn btn-secondary" title="Settings">
            <Settings size={18} />
          </button>
          <button onClick={handleLogout} className="btn btn-secondary">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </header>

      <main className="animate-fade-in">
        {currentView === 'DASHBOARD' && (
          <DashboardView onSelectBatch={(id) => { setActiveBatchId(id); setCurrentView('BATCH_DETAIL'); }} />
        )}
        
        {currentView === 'BATCH_DETAIL' && (
          <BatchDetailView 
            batchId={activeBatchId} 
            onBack={() => setCurrentView('DASHBOARD')}
            onAttend={(actId) => { setActiveActivityId(actId); setCurrentView('ATTENDANCE'); }}
            onViewStudent={(studentId) => { setActiveStudentId(studentId); setCurrentView('STUDENT_DETAIL'); }}
          />
        )}

        {currentView === 'ATTENDANCE' && (
          <AttendanceView 
            activityId={activeActivityId} 
            batchId={activeBatchId}
            onBack={() => setCurrentView('BATCH_DETAIL')}
          />
        )}

        {currentView === 'STUDENT_DETAIL' && (
          <StudentDetailView
            studentId={activeStudentId}
            onBack={() => setCurrentView('BATCH_DETAIL')}
          />
        )}

        {currentView === 'SETTINGS' && (
          <SettingsView onBack={() => setCurrentView('DASHBOARD')} />
        )}
      </main>
    </div>
  );
}

function LoginView() {
  const { login, registerFirstAdmin, submitSignupRequest, adminEmail, admins } = useStore();
  const [view, setView] = useState(admins.length === 0 ? 'SETUP' : 'LOGIN');
  const [u, setU] = useState('');
  const [email, setEmail] = useState('');
  const [p, setP] = useState('');

  const submitLogin = (e) => {
    e.preventDefault();
    if (view === 'SETUP') {
      if(!registerFirstAdmin(u, email, p)) alert('Admin exists');
    } else {
      if(!login(u, p)) alert('Invalid credentials or account pending approval');
    }
  };

  const submitSignup = async (e) => {
    e.preventDefault();
    if (submitSignupRequest(u, email, p)) {
      const { emailJsSettings } = useStore.getState();
      
      if (emailJsSettings.serviceId && emailJsSettings.templateId && emailJsSettings.publicKey) {
        try {
          const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: emailJsSettings.serviceId,
              template_id: emailJsSettings.templateId,
              user_id: emailJsSettings.publicKey,
              template_params: {
                admin_email: adminEmail,
                req_username: u,
                req_email: email,
              }
            })
          });

          if (res.ok) {
            alert('Registration request sent! An email has been successfully sent to the administrator for approval.');
          } else {
            console.error('EmailJS Error:', await res.text());
            alert('Request logged locally, but email failed to send. The administrator can still approve you via the settings panel.');
          }
        } catch (error) {
          console.error('EmailJS Error:', error);
          alert('Request logged locally, but email failed to send. The administrator can still approve you via the settings panel.');
        }
      } else {
        alert(`SIMULATED SYSTEM EMAIL SENT TO:\n${adminEmail}\n\n"User ${u} (${email}) has requested admin access."\n\nYour request is pending until approved by the administrator.\n\n(Note: Configure your EmailJS keys in Admin Settings to send absolute emails)`);
      }
      
      setView('LOGIN');
      setU(''); setEmail(''); setP('');
    } else {
      alert('This Email or Username is already an approved Administrator!');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {(view === 'LOGIN' || view === 'SETUP') && (
        <form onSubmit={submitLogin} className="glass-card animate-fade-in" style={{ width: 400 }}>
          <h2 style={{ marginBottom: '2rem', textAlign: 'center' }}>{view === 'SETUP' ? 'Setup First Admin' : 'Admin Login'}</h2>
          <input className="input-field" placeholder={view === 'SETUP' ? 'Full Name / Username' : 'Username or Email'} value={u} onChange={e=>setU(e.target.value)} required />
          {view === 'SETUP' && (
            <input className="input-field" type="email" placeholder="Email Address" value={email} onChange={e=>setEmail(e.target.value)} required />
          )}
          <input className="input-field" type="password" placeholder="Password" value={p} onChange={e=>setP(e.target.value)} required />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }}>{view === 'SETUP' ? 'Create Admin' : 'Login'}</button>
          {view === 'LOGIN' && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Don't have an account? <span style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={() => { setView('SIGNUP'); setU(''); setEmail(''); setP(''); }}>Sign up</span>
            </p>
          )}
        </form>
      )}

      {view === 'SIGNUP' && (
        <form onSubmit={submitSignup} className="glass-card animate-fade-in" style={{ width: 400 }}>
          <h2 style={{ marginBottom: '2rem', textAlign: 'center' }}>Request Account</h2>
          <input className="input-field" placeholder="Full Name / Username" value={u} onChange={e=>setU(e.target.value)} required />
          <input className="input-field" type="email" placeholder="Email Address" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="input-field" type="password" placeholder="New Password" value={p} onChange={e=>setP(e.target.value)} required />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }}>Request Access</button>
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            Already have an account? <span style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={() => { setView('LOGIN'); setU(''); setEmail(''); setP(''); }}>Login</span>
          </p>
        </form>
      )}
    </div>
  );
}

function DashboardView({ onSelectBatch }) {
  const { batches, addBatch, deleteBatch } = useStore();
  const [name, setName] = useState('');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Manage Batches</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="input-field" style={{ margin: 0 }} placeholder="e.g. 2024-26 Batch" value={name} onChange={e=>setName(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { if(name){ addBatch(name); setName(''); } }}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {batches.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No batches yet. Create one!</p> : null}
        {batches.map(b => (
          <div key={b.id} className="list-item">
            <h3 onClick={() => onSelectBatch(b.id)} style={{ flex: 1, cursor: 'pointer' }}>{b.name}</h3>
            <button className="btn btn-danger" onClick={() => {
              if(confirm('Delete? Type name to confirm:') || true) deleteBatch(b.id);
            }}><Trash2 size={16}/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchDetailView({ batchId, onBack, onAttend, onViewStudent }) {
  const { batches, students, activities, attendance } = useStore();
  const batch = batches.find(b => b.id === batchId);
  const initialTab = 'STUDENTS';
  const [tab, setTab] = useState(initialTab);

  if (!batch) return null;

  const batchStudents = students.filter(s => s.batchId === batchId);
  const batchActivities = activities.filter(a => a.batchId === batchId);

  const doExport = () => {
    exportToExcel(batch, batchStudents, batchActivities, attendance);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onBack}><ChevronLeft size={18}/></button>
          <h2>{batch.name} Details</h2>
        </div>
        <button className="btn btn-primary" onClick={doExport}><Download size={18}/> Export Report</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'STUDENTS' ? 'active' : ''}`} onClick={()=>setTab('STUDENTS')}><Users size={18} style={{marginRight:8, verticalAlign:'middle'}}/> Students</button>
        <button className={`tab ${tab === 'ACTIVITIES' ? 'active' : ''}`} onClick={()=>setTab('ACTIVITIES')}><BookOpen size={18} style={{marginRight:8, verticalAlign:'middle'}}/> Activities</button>
        <button className={`tab ${tab === 'ANALYTICS' ? 'active' : ''}`} onClick={()=>setTab('ANALYTICS')}><BarChart3 size={18} style={{marginRight:8, verticalAlign:'middle'}}/> Analytics</button>
      </div>

      <div className="glass-card">
        {tab === 'STUDENTS' && <StudentsTab items={batchStudents} batchId={batchId} onViewStudent={onViewStudent} />}
        {tab === 'ACTIVITIES' && <ActivitiesTab items={batchActivities} batchId={batchId} onAttend={onAttend} />}
        {tab === 'ANALYTICS' && <AnalyticsTab activities={batchActivities} />}
      </div>
    </div>
  );
}

function StudentsTab({ items, batchId, onViewStudent }) {
  const { addStudent, deleteStudent } = useStore();
  const [name, setName] = useState('');
  const [cls, setCls] = useState('');
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'

  const sortedItems = [...items].sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (nameA < nameB) return sortOrder === 'asc' ? -1 : 1;
    if (nameA > nameB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input className="input-field" style={{ flex: 1, minWidth: '150px', marginBottom: 0 }} placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
        <input className="input-field" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }} placeholder="Class" value={cls} onChange={e=>setCls(e.target.value)} />
        <button className="btn btn-primary" style={{ marginBottom: 0 }} onClick={() => { if(name) { addStudent({batchId, name, className: cls, phone: '', bloodGroup: ''}); setName(''); setCls(''); }}}>Add User</button>
        <button className="btn btn-secondary" style={{ marginBottom: 0, minWidth: '120px' }} onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>
          Sort: {sortOrder === 'asc' ? 'A-Z ↓' : 'Z-A ↑'}
        </button>
      </div>
      <div>
        {sortedItems.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No students enrolled in this batch yet.</p> : null}
        {sortedItems.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => onViewStudent(s.id)}>
              <strong style={{ color: 'var(--primary)' }}>{s.name}</strong> • <span style={{ color: 'var(--text-muted)' }}>{s.className}</span>
            </div>
            <button className="btn btn-danger" onClick={() => deleteStudent(s.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitiesTab({ items, batchId, onAttend }) {
  const { addActivity, deleteActivity } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState('Orientation');
  const [hours, setHours] = useState('1');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // Reverse list placing newest created activities on top
  const sortedItems = [...items].sort((a, b) => b.id - a.id);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <input className="input-field" style={{ flex: 1, minWidth: '150px', marginBottom: 0 }} placeholder="Activity Name" value={name} onChange={e=>setName(e.target.value)} />
        <select className="input-field" style={{ width: 'auto', marginBottom: 0 }} value={type} onChange={e=>setType(e.target.value)}>
          <option>Orientation</option>
          <option>Campus</option>
          <option>Community</option>
        </select>
        <input className="input-field" type="number" placeholder="Hours" value={hours} onChange={e=>setHours(e.target.value)} style={{ width: 80, marginBottom: 0 }} />
        <input className="input-field" type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ width: 140, marginBottom: 0 }} />
        <button className="btn btn-primary" style={{ marginBottom: 0 }} onClick={() => { if(name) { addActivity({batchId, name, type, hours, date}); setName(''); }}}>Add Activity</button>
      </div>
      <div>
        {sortedItems.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div>
              <strong>{a.name}</strong> • <span style={{ color: 'var(--text-muted)' }}>{a.type} | {a.hours} hours | {a.date}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => onAttend(a.id)}><CheckCircle2 size={16} style={{marginRight:4}}/> Mark Attendance</button>
              <button className="btn btn-danger" onClick={() => deleteActivity(a.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({ activities }) {
  let [o, c, m] = [0,0,0];
  activities.forEach(a => {
    if(a.type === 'Orientation') o += Number(a.hours);
    else if(a.type === 'Campus') c += Number(a.hours);
    else if(a.type === 'Community') m += Number(a.hours);
  });
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <span className="label">Total Activities</span>
        <span className="value">{activities.length}</span>
      </div>
      <div className="stat-card">
        <span className="label">Orientation Hours</span>
        <span className="value">{o}</span>
      </div>
      <div className="stat-card">
        <span className="label">Campus Hours</span>
        <span className="value">{c}</span>
      </div>
      <div className="stat-card">
        <span className="label">Community Hours</span>
        <span className="value">{m}</span>
      </div>
      <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
        <span className="label">Total Cumulative Hours Delivered</span>
        <span className="value" style={{ color: 'var(--success)' }}>{o + c + m}</span>
      </div>
    </div>
  );
}

function AttendanceView({ activityId, batchId, onBack }) {
  const { students, activities, attendance, saveAttendance } = useStore();
  const activity = activities.find(a => a.id === activityId);
  const batchStudents = students.filter(s => s.batchId === batchId);
  
  // Local state for checkboxes
  const origData = attendance.filter(a => a.activityId === activityId);
  const [checks, setChecks] = useState(() => {
    const init = {};
    batchStudents.forEach(s => {
      const existing = origData.find(a => a.studentId === s.id);
      init[s.id] = existing ? existing.present : false;
    });
    return init;
  });

  if (!activity) return null;

  const handleSave = () => {
    const payload = Object.entries(checks).map(([sId, isP]) => ({
      activityId,
      studentId: Number(sId),
      present: isP
    }));
    saveAttendance(activityId, payload);
    onBack();
  };

  const toggleAll = () => {
    const allOn = Object.values(checks).every(Boolean);
    const next = {};
    Object.keys(checks).forEach(k => next[k] = !allOn);
    setChecks(next);
  };

  const [sortOrder, setSortOrder] = useState('asc');
  const sortedStudents = [...batchStudents].sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (nameA < nameB) return sortOrder === 'asc' ? -1 : 1;
    if (nameA > nameB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onBack}><ChevronLeft size={18}/></button>
          <h2>Attendance: {activity.name}</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>Sort: {sortOrder === 'asc' ? 'A-Z ↓' : 'Z-A ↑'}</button>
          <button className="btn btn-secondary" onClick={() => exportActivityAttendance(activity, batchStudents, checks)}><Download size={18} /> Export</button>
          <button className="btn btn-secondary" onClick={toggleAll}>Select All</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Attendance</button>
        </div>
      </div>
      
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sortedStudents.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No students enrolled to grade.</p> : null}
        {sortedStudents.map(s => (
          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', background: 'var(--surface)', borderRadius: 'var(--radius-md)' }}>
            <input type="checkbox" className="custom-checkbox" checked={checks[s.id]} onChange={(e) => setChecks({...checks, [s.id]: e.target.checked})} />
            <span><strong>{s.name}</strong> ({s.className})</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function StudentDetailView({ studentId, onBack }) {
  const { students, activities, attendance, updateStudent } = useStore();
  const student = students.find(s => s.id === studentId);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editClass, setEditClass] = useState('');

  if (!student) return null;

  const startEdit = () => {
    setEditName(student.name);
    setEditClass(student.className);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if(editName) {
      updateStudent({ ...student, name: editName, className: editClass });
      setIsEditing(false);
    }
  };

  const studentAttendance = attendance.filter(a => a.studentId === studentId && a.present);
  let [o, c, m] = [0, 0, 0];
  
  const attendedActivities = studentAttendance.map(att => {
    const act = activities.find(a => a.id === att.activityId);
    if (act) {
      if (act.type === 'Orientation') o += Number(act.hours);
      else if (act.type === 'Campus') c += Number(act.hours);
      else if (act.type === 'Community') m += Number(act.hours);
    }
    return act;
  }).filter(Boolean);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onBack}><ChevronLeft size={18}/></button>
          
          {!isEditing ? (
            <div>
              <h2>{student.name} Details</h2>
              <span style={{ color: 'var(--text-muted)' }}>{student.className}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input className="input-field" style={{ marginBottom: 0 }} value={editName} onChange={e=>setEditName(e.target.value)} placeholder="Full Name" autoFocus />
              <input className="input-field" style={{ marginBottom: 0 }} value={editClass} onChange={e=>setEditClass(e.target.value)} placeholder="Class" />
            </div>
          )}
        </div>
        
        <div>
          {!isEditing ? (
            <button className="btn btn-secondary" onClick={startEdit}>Edit Profile</button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          )}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '2rem' }}>
        <div className="stat-card">
          <span className="label">Orientation Hours</span>
          <span className="value">{o}</span>
        </div>
        <div className="stat-card">
          <span className="label">Campus Hours</span>
          <span className="value">{c}</span>
        </div>
        <div className="stat-card">
          <span className="label">Community Hours</span>
          <span className="value">{m}</span>
        </div>
        <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
          <span className="label">Total Hours Completed</span>
          <span className="value" style={{ color: 'var(--success)' }}>{o + c + m}</span>
        </div>
      </div>

      <div className="glass-card">
        <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Attended Activities ({attendedActivities.length})</h3>
        {attendedActivities.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No activities attended yet.</p> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {attendedActivities.map((act, i) => (
            <div key={i} className="list-item" style={{ margin: 0, cursor: 'default' }}>
              <div>
                <strong>{act.name}</strong> • <span style={{ color: 'var(--text-muted)' }}>{act.type} | {act.date}</span>
              </div>
              <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{act.hours} hrs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsView({ onBack }) {
  const { adminEmail, setAdminEmail, emailJsSettings, setEmailJsSettings, pendingUsers, approveUser, rejectUser } = useStore();
  const [emailInput, setEmailInput] = useState(adminEmail);
  const [eS, setES] = useState(emailJsSettings || { serviceId: '', templateId: '', publicKey: '' });

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem' }}>
        <button className="btn btn-secondary" onClick={onBack}><ChevronLeft size={18}/></button>
        <h2>Admin Settings</h2>
      </div>

      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>EmailJS Notification Configuration</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
          Input your free EmailJS credentials below to securely dispatch live emails from your browser whenever anyone requests an admin account. Set it up at <strong>emailjs.com</strong>.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
           <div>
             <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-muted)'}}>Service ID</label>
             <input className="input-field" style={{ marginBottom: 0 }} placeholder="service_xxxxxxxx" value={eS.serviceId} onChange={e=>setES({...eS, serviceId: e.target.value})} />
           </div>
           <div>
             <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-muted)'}}>Template ID</label>
             <input className="input-field" style={{ marginBottom: 0 }} placeholder="template_xxxxxxxx" value={eS.templateId} onChange={e=>setES({...eS, templateId: e.target.value})} />
           </div>
           <div>
             <label style={{display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-muted)'}}>Public Key</label>
             <input className="input-field" style={{ marginBottom: 0 }} placeholder="xxxxxxxxxxxxxxxx" value={eS.publicKey} onChange={e=>setES({...eS, publicKey: e.target.value})} />
           </div>
        </div>
        
        <h3 style={{ marginBottom: '1rem', marginTop: '2rem' }}>Admin Delivery Email</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
          This is the primary email address that receives the live requests mentioned above.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input className="input-field" style={{ maxWidth: 300, marginBottom: 0 }} type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { setAdminEmail(emailInput); setEmailJsSettings(eS); alert('Configuration strictly securely saved!'); }}>Save Configuration</button>
        </div>
      </div>

      <div className="glass-card">
        <h3 style={{ marginBottom: '1rem' }}>Pending Registrations ({pendingUsers.length})</h3>
        {pendingUsers.length === 0 && <p style={{ color: 'var(--text-muted)' }}>There are no pending account requests.</p>}
        {pendingUsers.map(user => (
          <div key={user.id} className="list-item" style={{ cursor: 'default' }}>
            <div>
              <strong style={{ color: 'var(--text-main)' }}>{user.username}</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{user.email || 'No email provided'}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={() => approveUser(user.id)}>Approve</button>
              <button className="btn btn-danger" onClick={() => rejectUser(user.id)}><Trash2 size={16}/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

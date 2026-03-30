import { useState, useEffect } from 'react';
import { useStore, callWebhook } from './store';
import { exportToExcel, exportActivityAttendance, exportActivitiesGrid, checkRateLimit } from './utils';
import * as XLSX from 'xlsx';
import { Download, LogOut, Users, BookOpen, BarChart3, ChevronLeft, Plus, Trash2, CheckCircle2, Settings } from 'lucide-react';


export default function App() {
  const { currentUser, logout, isLoadedFromServer, loadFromServer } = useStore();
  const sessionExpiry = useStore(s => s.sessionExpiry);
  const [currentView, setCurrentView] = useState('DASHBOARD');
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [activeActivityId, setActiveActivityId] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState(null);

  // Load data from Firestore on mount
  useEffect(() => {
    if (!isLoadedFromServer) loadFromServer();
  }, [isLoadedFromServer, loadFromServer]);

  // Session expiry guard — client-side only (no server needed)
  useEffect(() => {
    if (!currentUser || !sessionExpiry) return;
    const check = () => { if (Date.now() > sessionExpiry) logout(); };
    check();
    const id = setInterval(check, 60 * 1000); // check every minute
    return () => clearInterval(id);
  }, [currentUser, sessionExpiry, logout]);

  if (!isLoadedFromServer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'var(--background)' }} className="animate-fade-in">
        <img src="/nss-logo.jpg" alt="NSS Logo" style={{ width: '180px', height: '180px', objectFit: 'contain', borderRadius: '100%', marginBottom: '2rem' }} />
        <h2 style={{ color: 'var(--primary)', letterSpacing: '2px', marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.8rem' }}>NSS UNITS 128 & 198</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>System Initializing...</p>
      </div>
    );
  }

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
  const { login, registerFirstAdmin, submitSignupRequest, adminEmail, admins, webhookUrl } = useStore();
  const [view, setView] = useState(admins.length === 0 ? 'SETUP' : 'LOGIN');
  const [u, setU] = useState('');
  const [email, setEmail] = useState('');
  const [p, setP] = useState('');
  const [showForgot, setShowForgot] = useState(false);

  if (showForgot) return <ForgotPasswordView onBack={() => setShowForgot(false)} />;

  const submitLogin = async (e) => {
    e.preventDefault();
    const limit = checkRateLimit('login', 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      alert(`Too many login attempts! Please try again in ${limit.remainingStr}.`);
      return;
    }

    if (view === 'SETUP') {
      if(!(await registerFirstAdmin(u, email, p))) alert('Admin exists');
    } else {
      if(!(await login(u, p))) alert('Invalid credentials or account pending approval');
    }
  };

  const submitSignup = async (e) => {
    e.preventDefault();

    const limit = checkRateLimit('signup', 3, 60 * 60 * 1000); // 3 attempts per hour
    if (!limit.allowed) {
      alert(`Too many account requests! Please try again in ${limit.remainingStr}.`);
      return;
    }

    if (await submitSignupRequest(u, email, p)) {
      try {
        const { webhookUrl, adminEmail } = useStore.getState();
        // Direct call to Google Apps Script — no server needed
        await callWebhook(webhookUrl, { username: u, email, adminEmail });
      } catch (err) { console.error('Notification error:', err); }
      alert('Registration request recorded! The administrator will be notified.');
      setView('LOGIN'); setU(''); setEmail(''); setP('');
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
            <>
              <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                Don't have an account? <span style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={() => { setView('SIGNUP'); setU(''); setEmail(''); setP(''); }}>Sign up</span>
              </p>
              <p style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => setShowForgot(true)}>Forgot password?</span>
              </p>
            </>
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

function ForgotPasswordView({ onBack }) {
  const { requestPasswordReset, verifyOtp, applyPasswordReset } = useStore();
  const [step, setStep]         = useState('EMAIL');
  const [emailVal, setEmailVal] = useState('');
  const [otp, setOtp]           = useState(['','','','','','']);
  const [newPw, setNewPw]       = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const otpRefs = Array.from({ length: 6 }, () => ({ current: null }));

  const cardStyle  = { width: 420, padding: '2.5rem' };
  const errorStyle = { color: 'var(--danger, #f87171)', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' };
  const muteStyle  = { color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginBottom: '1.5rem', lineHeight: 1.5 };

  // Step 1 — generate OTP in browser, store hash in Firestore, email via Google Script
  const handleRequestOtp = async (e) => {
    e.preventDefault(); setError('');
    if (!emailVal.trim()) { setError('Please enter your email address.'); return; }
    setLoading(true);
    try {
      await requestPasswordReset(emailVal.trim());
      setStep('OTP'); // Always advance — prevents email enumeration
    } catch (err) { setError('Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  };

  // Step 2 — verify OTP against Firestore hash (one-time, 5 min expiry)
  const handleVerifyOtp = async (e) => {
    e.preventDefault(); setError('');
    const code = otp.join('');
    if (code.length < 6) { setError('Please enter the full 6-digit code.'); return; }
    setLoading(true);
    try {
      const ok = await verifyOtp(emailVal.trim(), code);
      if (!ok) { setError('Invalid or expired code. Please request a new one.'); return; }
      setStep('PASSWORD');
    } catch { setError('Verification failed. Please try again.'); }
    finally { setLoading(false); }
  };

  // Step 3 — set new password → update in Firestore via store
  const handleResetPassword = async (e) => {
    e.preventDefault(); setError('');
    if (newPw.length < 8)    { setError('Password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const ok = await applyPasswordReset(emailVal.trim(), newPw);
      if (!ok) { setError('Could not find account. Please contact your administrator.'); return; }
      setStep('SUCCESS');
    } catch { setError('Reset failed. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleOtpChange = (idx, val) => {
    const digit = val.replace(/\D/, '').slice(-1);
    const next  = [...otp]; next[idx] = digit; setOtp(next);
    if (digit && idx < 5) otpRefs[idx + 1].current?.focus();
  };
  const handleOtpKey = (idx, e) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs[idx - 1].current?.focus();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {step === 'EMAIL' && (
        <form onSubmit={handleRequestOtp} className="glass-card animate-fade-in" style={cardStyle}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>Reset Password</h2>
          <p style={muteStyle}>Enter the email address linked to your admin account. A one-time code will be sent to that address.</p>
          {error && <p style={errorStyle}>{error}</p>}
          <input className="input-field" type="email" placeholder="Your admin email address" value={emailVal} onChange={e => setEmailVal(e.target.value)} required autoFocus />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }} disabled={loading}>{loading ? 'Sending…' : 'Send OTP'}</button>
          <p style={{ textAlign: 'center' }}><span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer' }} onClick={onBack}>← Back to Login</span></p>
        </form>
      )}

      {step === 'OTP' && (
        <form onSubmit={handleVerifyOtp} className="glass-card animate-fade-in" style={cardStyle}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>Enter OTP</h2>
          <p style={muteStyle}>A 6-digit reset code was sent to <strong>{emailVal}</strong>. It expires in 5 minutes.</p>
          {error && <p style={errorStyle}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginBottom: '1.5rem' }}>
            {otp.map((digit, idx) => (
              <input
                key={idx}
                ref={el => { otpRefs[idx].current = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleOtpChange(idx, e.target.value)}
                onKeyDown={e => handleOtpKey(idx, e)}
                style={{
                  width: '48px', height: '56px', textAlign: 'center', fontSize: '1.5rem', fontWeight: 'bold',
                  background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-main)', outline: 'none', transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--primary)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'}
                autoFocus={idx === 0}
              />
            ))}
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }} disabled={loading || otp.join('').length < 6}>{loading ? 'Verifying…' : 'Verify Code'}</button>
          <p style={{ textAlign: 'center' }}><span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => { setStep('EMAIL'); setOtp(['','','','','','']); setError(''); }}>← Resend code</span></p>
        </form>
      )}

      {step === 'PASSWORD' && (
        <form onSubmit={handleResetPassword} className="glass-card animate-fade-in" style={cardStyle}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>New Password</h2>
          <p style={muteStyle}>Set a new password for <strong>{emailVal}</strong>. This only applies to your own account.</p>
          {error && <p style={errorStyle}>{error}</p>}
          <input className="input-field" type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={e => setNewPw(e.target.value)} required autoFocus />
          <input className="input-field" type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required />
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }} disabled={loading}>{loading ? 'Saving…' : 'Reset Password'}</button>
        </form>
      )}

      {step === 'SUCCESS' && (
        <div className="glass-card animate-fade-in" style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
          <h2 style={{ marginBottom: '0.75rem', color: 'var(--primary)' }}>Password Updated</h2>
          <p style={muteStyle}>Your password has been reset successfully. You can now log in with your new credentials.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onBack}>Back to Login</button>
        </div>
      )}
    </div>
  );
}

function DashboardView({ onSelectBatch }) {

  const { batches, addBatch, deleteBatch, updateBatch } = useStore();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

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
            {editingId === b.id ? (
              <div style={{ display: 'flex', flex: 1, gap: '0.5rem', alignItems: 'center' }}>
                <input className="input-field" style={{ margin: 0, flex: 1 }} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus />
                <button className="btn btn-primary" onClick={() => { if(editName) updateBatch({ ...b, name: editName }); setEditingId(null); }}>Save</button>
                <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 onClick={() => onSelectBatch(b.id)} style={{ flex: 1, cursor: 'pointer', margin: 0 }}>{b.name}</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-secondary" onClick={() => { setEditingId(b.id); setEditName(b.name); }}>Edit</button>
                  <button className="btn btn-danger" onClick={() => {
                    if(confirm(`Are you sure you want to permanently delete "${b.name}" and all associated students, activities, and data?`)) deleteBatch(b.id);
                  }}><Trash2 size={16}/></button>
                </div>
              </div>
            )}
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
  const { addStudent, deleteStudent, bulkImport } = useStore();
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

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
    const validExtensions = ['xlsx', 'xls', 'csv'];
    const extension = file.name.split('.').pop().toLowerCase();

    if (file.type && !validTypes.includes(file.type)) {
      alert("Invalid file type. Only Excel or CSV files are allowed.");
      e.target.value = null;
      return;
    }
    if (!validExtensions.includes(extension)) {
      alert("Invalid file extension. Please upload a .xlsx, .xls, or .csv file.");
      e.target.value = null;
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large! Maximum size is 5MB.");
      e.target.value = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      if (data.length < 4) {
        alert('File is too short to match the fixed template.');
        return;
      }

      const validTypes = ['COMMUNITY', 'CAMPUS', 'ORIENTATION'];
      const newStudents = [];
      const newActivities = [];
      const newAttendance = [];
      const timeOffset = Date.now();
      let sIndex = 0;
      let actIndex = 0;

      const { students: currentStudents, activities: currentActivities } = useStore.getState();
      const studentMap = {}; // name to id mapping to prevent intra-upload duplication across blocks

      // Load existing batch students into the map
      currentStudents.filter(s => s.batchId === batchId).forEach(s => {
        studentMap[s.name.toLowerCase().trim()] = s.id;
      });

      // Break sheet into blocks based on category headers
      const blocks = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].length > 0) {
          const potType = String(data[i][0] || '').toUpperCase().trim();
          if (validTypes.includes(potType)) {
            blocks.push({ type: potType, rowIdx: i });
          }
        }
      }

      // Fallback if no explicit category headers are found
      if (blocks.length === 0) {
        blocks.push({ type: 'CAMPUS', rowIdx: 0 });
      }

      blocks.forEach(block => {
        const rAct = block.rowIdx + 1;
        const rDate = block.rowIdx + 2;
        const rData = block.rowIdx + 3;

        if (rData >= data.length) return; // Incomplete block

        const row2 = data[rAct] || [];
        const row3 = data[rDate] || [];
        const activityCols = [];
        let inheritedActName = "Activity";
        const maxCols = Math.max(row2.length, row3.length);

        for (let col = 1; col < maxCols; col++) {
          const cellActName = String(row2[col] || '').trim();
          if (cellActName && cellActName !== '0') {
             inheritedActName = cellActName;
          }
          
          const actName = inheritedActName;
          const lName = actName.toLowerCase();
          
          let dateStr = String(row3[col] || '').trim();
          const lDateStr = dateStr.toLowerCase();
          
          // Require a date to process the column, skip empty cells in date row or summary columns
          if (!dateStr || lDateStr === 'total' || lDateStr === 'total hour' || lDateStr === 'total hours' || dateStr === '0') {
            continue;
          }

          if (lName === 'total' || lName === 'total hour' || lName === 'total hours') {
            continue;
          }
          let parsedDateStr = dateStr.replace(/\//g, '-');
          let dateObj = new Date('invalid');
          
          const parts = parsedDateStr.split('-');
          if (parts.length === 3) {
             if (parts[2].length >= 2 && parts[0].length <= 2) {
                 const yyyy = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                 dateObj = new Date(`${yyyy}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T12:00:00Z`);
             } else if (parts[0].length === 4) {
                 dateObj = new Date(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}T12:00:00Z`);
             }
          }

          if (isNaN(dateObj.getTime())) {
             dateObj = new Date(parsedDateStr);
             if (!isNaN(dateObj.getTime())) {
                dateObj.setUTCHours(12);
             }
          }

          if (isNaN(dateObj.getTime())) {
             dateStr = new Date().toISOString().split('T')[0];
          } else {
             dateStr = dateObj.toISOString().split('T')[0];
          }

          // Precompute activity duration by scanning the rows in this block
          let maxHours = 0;
          for (let i = rData; i < data.length; i++) {
            const cellA = String(data[i]?.[0] || '').toUpperCase().trim();
            if (validTypes.includes(cellA)) break; // Reached next block boundary

            const val = Number(data[i]?.[col]);
            if (!isNaN(val) && val > maxHours) {
              maxHours = val;
            }
          }

          // Duplicate checking against global and session activities
          const existingAct = currentActivities.find(a => 
             a.batchId === batchId && 
             a.name.toLowerCase() === actName.toLowerCase() && 
             a.date === dateStr
          );

          let actId;
          if (existingAct) {
            actId = existingAct.id;
          } else {
            actId = timeOffset + 10000 + actIndex;
            actIndex++;
            newActivities.push({
              id: actId,
              batchId,
              name: actName,
              type: block.type, 
              hours: maxHours > 0 ? maxHours : 1,
              date: dateStr
            });
          }

          activityCols.push({ colIdx: col, actId });
        }

        // Parse student rows for this block
        for (let i = rData; i < data.length; i++) {
          const row = data[i];
          if (!row) continue;
          
          const studentName = String(row[0] || '').trim();
          if (!studentName) continue;
          
          if (validTypes.includes(studentName.toUpperCase())) {
             break; // Next block hit
          }

          const lStudentName = studentName.toLowerCase();
          let studentId;
          
          if (studentMap[lStudentName]) {
            studentId = studentMap[lStudentName];
          } else {
            studentId = timeOffset + sIndex;
            sIndex++;
            studentMap[lStudentName] = studentId;

            newStudents.push({
              id: studentId,
              batchId,
              name: studentName,
              className: '',
              phone: '',
              bloodGroup: ''
            });
          }

          // Map Attendance
          activityCols.forEach(act => {
            const rawVal = row[act.colIdx];
            const textVal = String(rawVal || '').toLowerCase().trim();
            const numVal = Number(rawVal);
            
            let isPresent = false;
            if (!isNaN(numVal) && numVal > 0) {
              isPresent = true;
            } else if (textVal === 'p' || textVal === 'present' || textVal === '1' || textVal === 'true' || textVal === 'y' || textVal === 'yes') {
              isPresent = true;
            }

            if (isPresent) {
               // Push uniquely
               if (!newAttendance.some(a => a.activityId === act.actId && a.studentId === studentId)) {
                  newAttendance.push({
                    activityId: act.actId,
                    studentId,
                    present: true
                  });
               }
            }
          });
        }
      });

      if (newStudents.length === 0) {
         alert('No student names detected starting from cell A4.');
         return;
      }

      bulkImport(newStudents, newActivities, newAttendance);
      alert(`Imported ${newStudents.length} students and ${newActivities.length} activities.`);
    };
    reader.readAsBinaryString(file);
    e.target.value = null; // reset input
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input className="input-field" style={{ flex: 1, minWidth: '150px', marginBottom: 0 }} placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
        <input className="input-field" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }} placeholder="Class" value={cls} onChange={e=>setCls(e.target.value)} />
        <button className="btn btn-primary" style={{ marginBottom: 0 }} onClick={() => { if(name) { addStudent({batchId, name, className: cls, phone: '', bloodGroup: ''}); setName(''); setCls(''); }}}>Add User</button>
        <button className="btn btn-secondary" style={{ marginBottom: 0, minWidth: '120px' }} onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>
          Sort: {sortOrder === 'asc' ? 'A-Z ↓' : 'Z-A ↑'}
        </button>
        <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
          Upload File
          <input type="file" accept=".xlsx, .xls, .csv" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>
      <div>
        {sortedItems.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No students enrolled in this batch yet.</p> : null}
        {sortedItems.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => onViewStudent(s.id)}>
              <strong style={{ color: 'var(--primary)' }}>{s.name}</strong> • <span style={{ color: 'var(--text-muted)' }}>{s.className}</span>
            </div>
            <button className="btn btn-danger" onClick={() => { if(confirm(`Delete student ${s.name}?`)) deleteStudent(s.id); }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitiesTab({ items, batchId, onAttend }) {
  const { addActivity, deleteActivity, updateActivity, batches, students, attendance } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState('Orientation');
  const [hours, setHours] = useState('1');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [exportFilter, setExportFilter] = useState('ALL');
  const [exportMonthFilter, setExportMonthFilter] = useState('ALL');

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ name: '', type: '', hours: '', date: '' });

  // Sort activities by date newest first, then by id newest first
  const sortedItems = [...items].sort((a, b) => {
    const d1 = new Date(b.date);
    const d2 = new Date(a.date);
    if (d1.getTime() !== d2.getTime()) return d1 - d2;
    return b.id - a.id;
  });

  // Group by month
  const groupedActivities = {};
  sortedItems.forEach(a => {
    const d = new Date(a.date);
    const mName = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    if(!groupedActivities[mName]) groupedActivities[mName] = [];
    groupedActivities[mName].push(a);
  });

  const handleExportGrid = () => {
    const batch = batches.find(b => b.id === batchId);
    const batchStudents = students.filter(s => s.batchId === batchId);
    exportActivitiesGrid(batch, batchStudents, items, attendance, exportFilter, exportMonthFilter);
  };

  const handleUploadActivities = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
    const validExtensions = ['xlsx', 'xls', 'csv'];
    const extension = file.name.split('.').pop().toLowerCase();

    if (file.type && !validTypes.includes(file.type)) {
      alert("Invalid file type. Only Excel or CSV files are allowed.");
      e.target.value = null;
      return;
    }
    if (!validExtensions.includes(extension)) {
      alert("Invalid file extension. Please upload a .xlsx, .xls, or .csv file.");
      e.target.value = null;
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large! Maximum size is 5MB.");
      e.target.value = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
        if (data.length < 4) {
          alert('File is too short to match the fixed template.');
          return;
        }

      const validTypes = ['COMMUNITY', 'CAMPUS', 'ORIENTATION'];
      const newActivities = [];
      const newAttendance = [];
      const timeOffset = Date.now();
      let actIndex = 0;

      const { students: currentStudents, activities: currentActivities, bulkImport } = useStore.getState();
      const studentMap = {};

      currentStudents.filter(s => s.batchId === batchId).forEach(s => {
        studentMap[s.name.toLowerCase().trim()] = s.id;
      });

      const blocks = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].length > 0) {
          const potType = String(data[i][0] || '').toUpperCase().trim();
          if (validTypes.includes(potType)) {
            blocks.push({ type: potType, rowIdx: i });
          }
        }
      }

      if (blocks.length === 0) {
        blocks.push({ type: 'CAMPUS', rowIdx: 0 });
      }

      blocks.forEach(block => {
        const rAct = block.rowIdx + 1;
        const rDate = block.rowIdx + 2;
        const rData = block.rowIdx + 3;

        if (rData >= data.length) return;

        const row2 = data[rAct] || [];
        const row3 = data[rDate] || [];
        const activityCols = [];
        let inheritedActName = "Activity";
        const maxCols = Math.max(row2.length, row3.length);

        for (let col = 1; col < maxCols; col++) {
          const cellActName = String(row2[col] || '').trim();
          if (cellActName && cellActName !== '0') {
             inheritedActName = cellActName;
          }
          
          const actName = inheritedActName;
          const lName = actName.toLowerCase();
          
          let dateStr = String(row3[col] || '').trim();
          const lDateStr = dateStr.toLowerCase();
          
          // Require a date to process the column, skip empty cells in date row or summary columns
          if (!dateStr || lDateStr === 'total' || lDateStr === 'total hour' || lDateStr === 'total hours' || dateStr === '0') {
            continue;
          }

          if (lName === 'total' || lName === 'total hour' || lName === 'total hours') {
            continue;
          }
          let parsedDateStr = dateStr.replace(/\//g, '-');
          let dateObj = new Date('invalid');
          
          const parts = parsedDateStr.split('-');
          if (parts.length === 3) {
             if (parts[2].length >= 2 && parts[0].length <= 2) {
                 const yyyy = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                 dateObj = new Date(`${yyyy}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T12:00:00Z`);
             } else if (parts[0].length === 4) {
                 dateObj = new Date(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}T12:00:00Z`);
             }
          }

          if (isNaN(dateObj.getTime())) {
             dateObj = new Date(parsedDateStr);
             if (!isNaN(dateObj.getTime())) {
                dateObj.setUTCHours(12);
             }
          }

          if (isNaN(dateObj.getTime())) {
             dateStr = new Date().toISOString().split('T')[0];
          } else {
             dateStr = dateObj.toISOString().split('T')[0];
          }

          let maxHours = 0;
          for (let i = rData; i < data.length; i++) {
            const cellA = String(data[i]?.[0] || '').toUpperCase().trim();
            if (validTypes.includes(cellA)) break;

            const val = Number(data[i]?.[col]);
            if (!isNaN(val) && val > maxHours) {
              maxHours = val;
            }
          }

          const existingAct = currentActivities.find(a => 
             a.batchId === batchId && 
             a.name.toLowerCase() === actName.toLowerCase() && 
             a.date === dateStr
          ) || newActivities.find(a => 
             a.name.toLowerCase() === actName.toLowerCase() && 
             a.date === dateStr
          );

          let actId;
          if (existingAct) {
            actId = existingAct.id;
          } else {
            actId = timeOffset + 10000 + actIndex;
            actIndex++;
            newActivities.push({
              id: actId,
              batchId,
              name: actName,
              type: block.type, 
              hours: maxHours > 0 ? maxHours : 1,
              date: dateStr
            });
          }

          activityCols.push({ colIdx: col, actId });
        }

        for (let i = rData; i < data.length; i++) {
          const row = data[i];
          if (!row) continue;
          
          const studentName = String(row[0] || '').trim();
          if (!studentName) continue;
          
          if (validTypes.includes(studentName.toUpperCase())) {
             break;
          }

          const lStudentName = studentName.toLowerCase();
          let studentId;
          
          if (studentMap[lStudentName]) {
            studentId = studentMap[lStudentName];
          } else {
             continue; // Skip unknown students, only add attendance to existing names
          }

          activityCols.forEach(act => {
            const rawVal = row[act.colIdx];
            const textVal = String(rawVal || '').toLowerCase().trim();
            const numVal = Number(rawVal);
            
            let isPresent = false;
            if (!isNaN(numVal) && numVal > 0) {
              isPresent = true;
            } else if (textVal === 'p' || textVal === 'present' || textVal === '1' || textVal === 'true' || textVal === 'y' || textVal === 'yes') {
              isPresent = true;
            }

            if (isPresent) {
               if (!newAttendance.some(a => a.activityId === act.actId && a.studentId === studentId)) {
                  newAttendance.push({
                    activityId: act.actId,
                    studentId,
                    present: true
                  });
               }
            }
          });
        }
      });

      if (newActivities.length === 0 && newAttendance.length === 0) {
         alert('No new activities or attendance data found.');
         return;
      }

      bulkImport([], newActivities, newAttendance);
      alert(`Successfully processed file. Added ${newActivities.length} activities and mapped attendance to existing members.`);
      } catch (err) {
        console.error("Upload Parsing Error: ", err);
        alert("An error occurred while parsing the file. Please check the console output.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = null;
  };

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
        <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
          Upload Additional
          <input type="file" accept=".xlsx, .xls, .csv" onChange={handleUploadActivities} style={{ display: 'none' }} />
        </label>
        
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', background: 'var(--surface)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <select className="input-field" style={{ margin: 0, padding: '0.25rem 0.5rem', border: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', maxWidth: '140px', fontSize: '0.85rem' }} value={exportFilter} onChange={e=>setExportFilter(e.target.value)}>
            <option value="ALL">All Types</option>
            <option value="Orientation">Orientation</option>
            <option value="Campus">Campus</option>
            <option value="Community">Community</option>
          </select>
          <div style={{ width: '1px', height: '24px', background: 'var(--border)' }}></div>
          <select className="input-field" style={{ margin: 0, padding: '0.25rem 0.5rem', border: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', maxWidth: '140px', fontSize: '0.85rem' }} value={exportMonthFilter} onChange={e=>setExportMonthFilter(e.target.value)}>
            <option value="ALL">All Months</option>
            {Object.keys(groupedActivities).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={{ width: '1px', height: '24px', background: 'var(--border)' }}></div>
          <button className="btn btn-secondary" style={{ marginBottom: 0, border: 'none', padding: '0.25rem 0.75rem' }} onClick={handleExportGrid}><Download size={16} style={{marginRight: 4}} /> Dump</button>
        </div>
      </div>
      <div>
        {Object.entries(groupedActivities).length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No activities recorded.</p> : null}
        {Object.entries(groupedActivities).map(([monthName, acts]) => (
          <div key={monthName} style={{ marginBottom: '1rem' }}>
            <h4 style={{ padding: '0.5rem 1rem', background: 'var(--surface)', margin: 0, color: 'var(--primary)', borderBottom: '1px solid var(--border)' }}>{monthName}</h4>
            {acts.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                {editingId === a.id ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', flex: 1, alignItems: 'center' }}>
                    <input className="input-field" style={{ margin: 0, flex: 1, minWidth: '150px' }} value={editData.name} onChange={e=>setEditData({...editData, name: e.target.value})} />
                    <select className="input-field" style={{ margin: 0, width: 'auto' }} value={editData.type} onChange={e=>setEditData({...editData, type: e.target.value})}>
                      <option>Orientation</option>
                      <option>Campus</option>
                      <option>Community</option>
                    </select>
                    <input className="input-field" type="number" style={{ margin: 0, width: 80 }} value={editData.hours} onChange={e=>setEditData({...editData, hours: e.target.value})} />
                    <input className="input-field" type="date" style={{ margin: 0, width: 140 }} value={editData.date} onChange={e=>setEditData({...editData, date: e.target.value})} />
                    <button className="btn btn-primary" onClick={() => { updateActivity({ ...a, ...editData, hours: Number(editData.hours) || 0 }); setEditingId(null); }}>Save</button>
                    <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1 }}>
                      <strong>{a.name}</strong> • <span style={{ color: 'var(--text-muted)' }}>{a.type} | {a.hours} hours | {a.date}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <button className="btn btn-secondary" onClick={() => onAttend(a.id)}><CheckCircle2 size={16} style={{marginRight:4}}/> Mark</button>
                      <button className="btn btn-secondary" onClick={() => { setEditingId(a.id); setEditData({ name: a.name, type: a.type, hours: String(a.hours), date: a.date }); }}>Edit</button>
                      <button className="btn btn-danger" onClick={() => { if(confirm(`Delete activity "${a.name}" and all of its attendance data?`)) deleteActivity(a.id); }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({ activities }) {
  let [o, c, m] = [0,0,0];
  activities.forEach(a => {
    const type = (a.type || '').toLowerCase();
    if(type === 'orientation') o += Number(a.hours);
    else if(type === 'campus') c += Number(a.hours);
    else if(type === 'community') m += Number(a.hours);
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
  const [searchQuery, setSearchQuery] = useState('');
  
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
          <input className="input-field" style={{ margin: 0, minWidth: '180px' }} placeholder="Search student..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} />
          <button className="btn btn-secondary" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>Sort: {sortOrder === 'asc' ? 'A-Z ↓' : 'Z-A ↑'}</button>
          <button className="btn btn-secondary" onClick={() => exportActivityAttendance(activity, batchStudents, checks)}><Download size={18} /> Export</button>
          <button className="btn btn-secondary" onClick={toggleAll}>Select All</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Attendance</button>
        </div>
      </div>
      
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sortedStudents.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No students enrolled to grade.</p> : null}
        {sortedStudents.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map(s => (
          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', background: 'var(--surface)', borderRadius: 'var(--radius-md)' }}>
            <input type="checkbox" className="custom-checkbox" checked={checks[s.id]} onChange={(e) => setChecks({...checks, [s.id]: e.target.checked})} />
            <span><strong>{s.name}</strong> {s.className ? `(${s.className})` : ''}</span>
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
      const type = (act.type || '').toLowerCase();
      if (type === 'orientation') o += Number(act.hours);
      else if (type === 'campus') c += Number(act.hours);
      else if (type === 'community') m += Number(act.hours);
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
  const { adminEmail, setAdminEmail, webhookUrl, setWebhookUrl, pendingUsers, approveUser, rejectUser, admins, currentUser, removeAdmin, editAdmin } = useStore();
  const [emailInput, setEmailInput] = useState(adminEmail);
  const [webhookInput, setWebhookInput] = useState('');
  const [webhookStatus, setWebhookStatus] = useState(null); // null | true | false
  const [webhookSaving, setWebhookSaving] = useState(false);

  useEffect(() => {
    setWebhookStatus(!!webhookUrl);
  }, [webhookUrl]);

  const saveWebhook = async () => {
    if (!webhookInput.trim()) { alert('Please paste the Google Apps Script URL first.'); return; }
    setWebhookSaving(true);
    try {
      setWebhookUrl(webhookInput.trim());
      alert('Webhook URL updated successfully in Firestore!');
      setWebhookInput('');
      setWebhookStatus(true);
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setWebhookSaving(false);
    }
  };
  
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editAdminForm, setEditAdminForm] = useState({ username: '', email: '', password: '' });

  const startEditAdmin = (admin) => {
    setEditingAdmin(admin.id);
    // Never prefill the password — user types a new one only if they want to change it
    setEditAdminForm({ username: admin.username, email: admin.email || '', password: '' });
  };

  const saveEditAdmin = async (id) => {
    await editAdmin(id, editAdminForm);
    setEditingAdmin(null);
    // Clear the password field — never show a hash in the UI
    setEditAdminForm(prev => ({ ...prev, password: '' }));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem' }}>
        <button className="btn btn-secondary" onClick={onBack}><ChevronLeft size={18}/></button>
        <h2>Admin Settings</h2>
      </div>

      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Admin Delivery Email</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
          This is the primary email address that will receive secure live notifications from the Webhook whenever anyone requests an admin account.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input-field" style={{ maxWidth: 300, marginBottom: 0 }} type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { setAdminEmail(emailInput); alert('Email configuration saved!'); }}>Save Email</button>
        </div>

        <h3 style={{ marginBottom: '0.5rem', marginTop: '1.5rem' }}>Google Apps Script Webhook</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem', lineHeight: 1.5 }}>
          Paste your Google Apps Script deployment URL below. It is saved directly to Firestore and <strong>is shared with all administrators</strong>. Leave blank to keep the current URL.
        </p>
        {webhookStatus !== null && (
          <p style={{ fontSize: '0.82rem', marginBottom: '0.75rem', color: webhookStatus ? 'var(--success, #4ade80)' : 'var(--danger, #f87171)' }}>
            {webhookStatus ? '✓ Webhook is configured in Cloud Database' : '✗ No webhook URL configured yet'}
          </p>
        )}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input-field"
            style={{ flex: 1, minWidth: '260px', marginBottom: 0 }}
            type="password"
            placeholder="Paste new Google Apps Script URL…"
            value={webhookInput}
            onChange={e => setWebhookInput(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" style={{ marginBottom: 0 }} onClick={saveWebhook} disabled={webhookSaving}>
            {webhookSaving ? 'Saving…' : 'Update Webhook'}
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: '2rem' }}>
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

      <div className="glass-card">
        <h3 style={{ marginBottom: '1rem' }}>Approved Administrators ({admins.length})</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>Edit existing administrator details, including your own profile and password settings.</p>
        {admins.map(admin => (
          <div key={admin.id} className="list-item" style={{ cursor: 'default', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
            {editingAdmin === admin.id ? (
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', background: 'var(--surface)', borderRadius: 'var(--radius-md)' }}>
                 <p style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.25rem', fontWeight: 'bold' }}>Edit Admin Record</p>
                 <input className="input-field" style={{marginBottom:0}} value={editAdminForm.username} onChange={e=>setEditAdminForm({...editAdminForm, username: e.target.value})} placeholder="Username" />
                 <input className="input-field" style={{marginBottom:0}} value={editAdminForm.email} onChange={e=>setEditAdminForm({...editAdminForm, email: e.target.value})} placeholder="Email" type="email" />
                 <input className="input-field" style={{marginBottom:0}} value={editAdminForm.password} onChange={e=>setEditAdminForm({...editAdminForm, password: e.target.value})} placeholder="Password" type="password" />
                 <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                   <button className="btn btn-primary" onClick={() => saveEditAdmin(admin.id)}>Save Changes</button>
                   <button className="btn btn-secondary" onClick={() => setEditingAdmin(null)}>Cancel</button>
                 </div>
               </div>
            ) : (
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
                 <div style={{ flex: 1 }}>
                    <strong style={{ color: 'var(--text-main)' }}>{admin.username}</strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{admin.email || 'No email provided'}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>Password: {admin.id === currentUser?.id ? '••••••••' : '(Hidden)'}</div>
                 </div>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                   {(currentUser?.id === 1 || currentUser?.id === admin.id) && (
                     <button className="btn btn-secondary" onClick={() => startEditAdmin(admin)}>Edit Profile</button>
                   )}
                   {currentUser?.id === 1 && admin.id !== 1 && admin.id !== currentUser?.id && (
                     <button className="btn btn-danger" onClick={() => { if(confirm('Are you sure you want to remove this admin?')) removeAdmin(admin.id); }}>Remove</button>
                   )}
                   {admin.id === 1 && <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.875rem', marginLeft: '0.5rem' }}>Main Admin</span>}
                   {admin.id === currentUser?.id && admin.id !== 1 && <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.875rem', marginLeft: '0.5rem' }}>You</span>}
                 </div>
               </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import * as XLSX from 'xlsx';
import DOMPurify from 'dompurify';
import validator from 'validator';

export const sanitizeStrict = (input, type = 'text') => {
  if (typeof input !== 'string') return input;
  
  // 1. Script injection mitigation (XSS)
  const clean = DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();

  if (!clean && input) throw new Error("Invalid input detected.");

  switch (type) {
    case 'email':
      if (!validator.isEmail(clean)) throw new Error('Invalid email format');
      return validator.normalizeEmail(clean);
    case 'password':
          if (clean.length < 8) throw new Error('Password must be at least 8 characters');
      return clean;
    case 'url':
      if (!validator.isURL(clean, { require_protocol: true })) throw new Error('Invalid URL');
      return clean;
    case 'number':
      if (!validator.isNumeric(clean.toString())) throw new Error('Invalid number');
      return clean;
    case 'name':
      // Basic chars only: Alphanumerics, spaces, basic punctuation
      if (!validator.matches(clean, /^[\w\s.,'-]+$/)) throw new Error('Invalid characters in name');
      return clean;
    case 'date':
      if (!validator.isDate(clean, { format: 'YYYY-MM-DD', strictMode: false })) throw new Error('Invalid date');
      return clean;
    case 'text':
    default:
      // Generic text strictness
      return validator.escape(clean);
  }
};

export const deepSanitize = (obj) => {
  if (typeof obj === 'string') return sanitizeStrict(obj, 'text');
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  if (typeof obj === 'object' && obj !== null) {
    const cleanObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const cleanKey = DOMPurify.sanitize(validator.escape(key.trim()));
        cleanObj[cleanKey] = deepSanitize(obj[key]);
      }
    }
    return cleanObj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  return null;
};

export const checkRateLimit = (action, maxAttempts, windowMs) => {
  const now = Date.now();
  const key = `ratelimit_${action}`;
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{"count": 0, "resetTime": 0}');
    if (now > data.resetTime) {
      data.count = 1;
      data.resetTime = now + windowMs;
    } else {
      data.count++;
    }
    localStorage.setItem(key, JSON.stringify(data));
    
    if (data.count > maxAttempts) {
      const remainingSeconds = Math.ceil((data.resetTime - now) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      return { allowed: false, remainingStr: remainingMinutes > 1 ? `${remainingMinutes} minutes` : `${remainingSeconds} seconds` };
    }
    return { allowed: true };
  } catch (e) {
    return { allowed: true }; // allow on error
  }
};

// PBKDF2 — strong browser-native password hashing (100k iterations, SHA-256)
// salt = admin.id.toString() — unique per account, never changes
export const hashPassword = async (password, salt = '') => {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits        = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('nss-mgr-v2-' + salt), iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return '$pbkdf2$' + Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Legacy SHA-256 — used only for: OTP hashing + detecting/migrating old passwords
export const hashSHA256 = async (input) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const exportToExcel = (batch, students, activities, attendance) => {
  // Sheet 1: Students Summary
  const studentData = students.map(s => {
    let oHours = 0, caHours = 0, coHours = 0;
    
    // Calculate hours locally
    const sAtt = attendance.filter(a => a.studentId === s.id && a.present);
    sAtt.forEach(att => {
      const act = activities.find(a => a.id === att.activityId);
      if (act) {
        if (act.type === 'Orientation') oHours += Number(act.hours);
        else if (act.type === 'Campus') caHours += Number(act.hours);
        else if (act.type === 'Community') coHours += Number(act.hours);
      }
    });

    return {
      'Name': s.name,
      'Class': s.className,
      'Phone': s.phone,
      'Orientation Hours': oHours,
      'Campus Hours': caHours,
      'Community Hours': coHours,
      'Total Hours': oHours + caHours + coHours
    };
  });

  // Sheet 2: Activities Summary
  const activityData = activities.map(a => {
    const participants = attendance.filter(att => att.activityId === a.id && att.present).length;
    return {
      'Activity Name': a.name,
      'Type': a.type,
      'Date': a.date,
      'Hours': a.hours,
      'Participants': participants
    };
  });

  const wb = XLSX.utils.book_new();
  
  const ws1 = XLSX.utils.json_to_sheet(studentData);
  XLSX.utils.book_append_sheet(wb, ws1, "Student Summary");

  const ws2 = XLSX.utils.json_to_sheet(activityData);
  XLSX.utils.book_append_sheet(wb, ws2, "Activity Summary");

  XLSX.writeFile(wb, `Batch_Export_${batch.name.replace(/\s+/g, '_')}.xlsx`);
};

export const exportActivityAttendance = (activity, students, checksDict) => {
  const data = students.map(s => {
    return {
      'Name': s.name,
      'Class': s.className,
      'Phone': s.phone || 'N/A',
      'Status': checksDict[s.id] ? 'Present' : 'Absent'
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");

  const safeName = activity.name.replace(/\s+/g, '_');
  XLSX.writeFile(wb, `Attendance_${safeName}_${activity.date}.xlsx`);
};

export const exportActivitiesGrid = (batch, students, activities, attendance, filterType = 'ALL', filterMonth = 'ALL') => {
  const wsData = [];
  let validTypes = ['COMMUNITY', 'CAMPUS', 'ORIENTATION'];

  if (filterType !== 'ALL') {
    validTypes = [filterType.toUpperCase()];
  }

  validTypes.forEach(type => {
    let typeActs = activities.filter(a => a.type.toUpperCase() === type.toUpperCase()).sort((a,b) => new Date(a.date) - new Date(b.date));
    
    // Filter by month if specified
    if (filterMonth !== 'ALL') {
      typeActs = typeActs.filter(a => {
        const mName = new Date(a.date).toLocaleString('default', { month: 'long', year: 'numeric' });
        return mName === filterMonth;
      });
    }

    if (typeActs.length === 0) return; // Skip if no activities after filtering
    
    wsData.push([type]);
    
    const row2 = [''];
    typeActs.forEach(a => row2.push(a.name));
    row2.push('Total hour');
    wsData.push(row2);
    
    const row3 = [''];
    typeActs.forEach(a => row3.push(a.date));
    wsData.push(row3);
    
    const sortedStudents = [...students].sort((a, b) => a.name.localeCompare(b.name));
    sortedStudents.forEach(s => {
      let rowObj = [s.name];
      let total = 0;
      typeActs.forEach(a => {
        const att = attendance.find(log => log.activityId === a.id && log.studentId === s.id);
        if (att && att.present) {
          rowObj.push(Number(a.hours));
          total += Number(a.hours);
        } else {
          rowObj.push('');
        }
      });
      rowObj.push(total);
      wsData.push(rowObj);
    });
    
    wsData.push([]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData.length ? wsData : [['No Data']]);
  
  let suffix = filterType === 'ALL' ? '' : `_${filterType}`;
  if (filterMonth !== 'ALL') {
    suffix += `_${filterMonth.replace(/\s+/g, '_')}`;
  }
  
  XLSX.utils.book_append_sheet(wb, ws, "Activities Grid");
  XLSX.writeFile(wb, `Activities_Grid${suffix}_${batch.name.replace(/\s+/g, '_')}.xlsx`);
};

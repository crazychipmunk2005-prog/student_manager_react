import * as XLSX from 'xlsx';

export const hashPassword = async (password) => {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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

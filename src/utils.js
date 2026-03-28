import * as XLSX from 'xlsx';

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

  XLSX.writeFile(wb, `Batch_Export_${batch.name.replace(/\\s+/g, '_')}.xlsx`);
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

  const safeName = activity.name.replace(/\\s+/g, '_');
  XLSX.writeFile(wb, `Attendance_${safeName}_${activity.date}.xlsx`);
};

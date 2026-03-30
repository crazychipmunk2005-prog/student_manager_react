// ═══════════════════════════════════════════════════════════════
// NSS Student Manager — Google Apps Script Webhook
// Deploy this from the nsssecretay2025@gmail.com Google account
// so all outgoing emails come FROM that address automatically.
// ═══════════════════════════════════════════════════════════════

var ADMIN_EMAIL = 'nsssecretay2025@gmail.com';

function doPost(e) {
  var data;
  try {
    var body = e.postData ? e.postData.contents : '';
    data = JSON.parse(body);
  } catch (err) {
    MailApp.sendEmail(ADMIN_EMAIL, 'GAS Parse Error', 'Body: ' + JSON.stringify(e));
    return ContentService.createTextOutput('Parse error: ' + err.message);
  }

  // ── OTP Password Reset ──────────────────────────────────────
  if (data.type === 'otp_reset') {
    var subject = "Your NSS Admin Password Reset Code";
    var body = "Your one-time password reset code is:\n\n"
             + "  " + data.otp + "\n\n"
             + "This code expires in 5 minutes.\n"
             + "If you did not request this, ignore this email.";
    MailApp.sendEmail(data.targetEmail, subject, body);
    return ContentService.createTextOutput("Success");
  }

  // ── User Sign-In Alert ──────────────────────────────────────
  if (data.type === 'sign_in_alert') {
    var subject = "Sign-In Alert: " + data.username;
    var body = "A user has signed in to the NSS Student Manager.\n\n"
             + "Username: " + data.username + "\n"
             + "Email: " + (data.email || 'N/A') + "\n"
             + "Time: " + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + "\n";
    MailApp.sendEmail(ADMIN_EMAIL, subject, body);
    return ContentService.createTextOutput("Success");
  }

  // ── Signup Notification (default) ───────────────────────────
  var subject = "New Admin Access Request from " + data.username;
  var body = "A new user has requested admin access.\n\n"
           + "Username: " + data.username + "\n"
           + "Email: " + data.email + "\n\n"
           + "Please log in to the system to approve them.";
  MailApp.sendEmail(ADMIN_EMAIL, subject, body);
  return ContentService.createTextOutput("Success");
}

function doGet(e) {
  return ContentService.createTextOutput("NSS Webhook active");
}

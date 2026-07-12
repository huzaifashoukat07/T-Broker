// Email delivery for OTP verification codes.
// Configure SMTP via environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// (e.g. Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com
//  SMTP_PASS=<app password>)
// Without SMTP configured the server runs in dev mode: codes are printed to
// the console instead of being emailed.

const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  console.log(`[mail] SMTP configured: ${process.env.SMTP_HOST}:${port}`);
} else {
  console.log('[mail] SMTP not configured — verification codes will be printed to this console (set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS to send real emails)');
}

const FROM = process.env.SMTP_FROM || process.env.SMTP_USER || 'NovaTrade <no-reply@novatrade.local>';

// Returns true if the email was actually sent, false in dev/console mode.
async function sendOtp(email, code, purpose) {
  if (!transport) {
    console.log(`[mail] ${purpose} code for ${email}: ${code}`);
    return false;
  }
  await transport.sendMail({
    from: FROM,
    to: email,
    subject: `${code} is your NovaTrade verification code`,
    text: `Your NovaTrade ${purpose} code is: ${code}\n\nIt expires in 5 minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;background:#0b0f19;border-radius:14px;padding:32px;color:#e7ecf5">
        <div style="font-size:22px;font-weight:800;margin-bottom:6px">Nova<span style="color:#2f7cf6">Trade</span></div>
        <p style="color:#8493b3;font-size:14px;margin:0 0 22px">Use this code to complete your ${purpose}:</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#141c30;border:1px solid #232f4e;border-radius:10px;padding:18px 0">${code}</div>
        <p style="color:#8493b3;font-size:12px;margin:22px 0 0">The code expires in 5 minutes. If you didn't request this, ignore this email.</p>
      </div>`,
  });
  return true;
}

module.exports = { sendOtp };

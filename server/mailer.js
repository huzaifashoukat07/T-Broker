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
    secure: port === 465, // 465 = implicit TLS; 587 uses STARTTLS
    requireTLS: port !== 465, // enforce STARTTLS on 587
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    // fail fast instead of hanging forever if a port is blocked
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
  console.log(`[mail] SMTP configured: ${process.env.SMTP_HOST}:${port} — verifying…`);
  // Verify credentials at startup so problems surface immediately instead of
  // only when the first user tries to sign up.
  transport.verify()
    .then(() => console.log('[mail] SMTP connection OK — OTP codes will be emailed'))
    .catch((e) => console.error(`[mail] SMTP verify FAILED (${e.message}) — check SMTP_USER/SMTP_PASS. Emails will fail; codes still print to console`));
} else {
  console.log('[mail] SMTP not configured — verification codes will be printed to this console (set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS to send real emails)');
}

const BRAND = process.env.BRAND_NAME || 'NovaTrade';
const SITE = process.env.SITE_URL || 'https://nova-market.trade';
const SUPPORT = process.env.SUPPORT_EMAIL || process.env.SMTP_USER || 'info@nova-market.trade';
const FROM = process.env.SMTP_FROM || `${BRAND} <${SUPPORT}>`;

// Returns true if the email was actually sent, false in dev/console mode.
async function sendOtp(email, code, purpose) {
  if (!transport) {
    console.log(`[mail] ${purpose} code for ${email}: ${code}`);
    return false;
  }
  const year = new Date().getFullYear();
  await transport.sendMail({
    from: FROM,
    to: email,
    subject: `${code} is your ${BRAND} verification code`,
    replyTo: SUPPORT,
    text:
`Your ${BRAND} ${purpose} code is: ${code}

This code expires in 5 minutes. Never share it with anyone — our team will never ask you for it.

If you didn't request this, you can safely ignore this email.

— The ${BRAND} Team
${SITE}
Support: ${SUPPORT}

© ${year} ${BRAND}. All rights reserved.
This is an automated message, please do not reply.`,
    html: `
  <div style="margin:0;padding:24px 12px;background:#070a12;font-family:'Segoe UI',Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;margin:0 auto">
      <tr><td style="background:#0b0f19;border:1px solid #232f4e;border-radius:16px;overflow:hidden">

        <!-- header -->
        <div style="padding:26px 32px 18px;border-bottom:1px solid #1a2440">
          <span style="font-size:22px;font-weight:800;color:#e7ecf5;letter-spacing:.3px">Nova<span style="color:#2f7cf6">Trade</span></span>
        </div>

        <!-- body -->
        <div style="padding:28px 32px 12px;color:#e7ecf5">
          <p style="margin:0 0 6px;font-size:16px;font-weight:700">Verify your ${purpose}</p>
          <p style="margin:0 0 22px;color:#8493b3;font-size:13.5px;line-height:1.6">Enter the code below to continue. It expires in <b style="color:#e7ecf5">5 minutes</b>.</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:12px;text-align:center;color:#fff;background:#141c30;border:1px solid #2f7cf6;border-radius:12px;padding:20px 0">${code}</div>
          <p style="margin:22px 0 0;color:#f7b32b;font-size:12.5px;line-height:1.6">🔒 Never share this code. ${BRAND} staff will never ask you for it.</p>
          <p style="margin:14px 0 0;color:#8493b3;font-size:12.5px;line-height:1.6">If you didn't request this, you can safely ignore this email — no action is needed.</p>
        </div>

        <!-- signature -->
        <div style="padding:20px 32px;border-top:1px solid #1a2440;color:#8493b3;font-size:12.5px;line-height:1.7">
          Best regards,<br>
          <span style="color:#e7ecf5;font-weight:700">The ${BRAND} Team</span><br>
          <a href="${SITE}" style="color:#2f7cf6;text-decoration:none">${SITE.replace(/^https?:\/\//, '')}</a> &nbsp;·&nbsp;
          <a href="mailto:${SUPPORT}" style="color:#2f7cf6;text-decoration:none">${SUPPORT}</a>
        </div>

        <!-- footer -->
        <div style="padding:16px 32px;background:#070a12;color:#5c6a89;font-size:11px;line-height:1.6;text-align:center">
          © ${year} ${BRAND}. All rights reserved.<br>
          This is an automated message — please do not reply directly.
        </div>

      </td></tr>
    </table>
  </div>`,
  });
  return true;
}

module.exports = { sendOtp };

import nodemailer from 'nodemailer';

/**
 * Email delivery via Nodemailer/SMTP.
 *
 * SMTP is considered configured only when HOST, USER and PASS are ALL set — a
 * host with blank credentials (the old default) silently failed to send. When
 * not configured, sendEmail logs the message instead so dev/OTP flows still work.
 */
export function isEmailConfigured() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const port = Number(process.env.EMAIL_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/2525 = STARTTLS
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // Fail fast instead of hanging a request if the SMTP host is unreachable.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/** Verify SMTP connectivity/credentials. Used at boot and by /api/health. */
export async function verifyEmailTransport() {
  if (!isEmailConfigured()) return { ok: false, reason: 'EMAIL_HOST / EMAIL_USER / EMAIL_PASS are not all set' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Send an email. Returns { sent: true } on success, { sent: false, logged: true }
 * when SMTP isn't configured (dev fallback). Throws only on a real send failure
 * so callers can decide how to surface it.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    console.log('\n📧 [Email not configured — logging instead]');
    console.log(`   To:      ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body:    ${text || html}\n`);
    return { sent: false, logged: true };
  }
  const info = await getTransport().sendMail({
    from: process.env.EMAIL_FROM || 'ChatConnect <no-reply@chatconnect.app>',
    to,
    subject,
    text,
    html,
  });
  return { sent: true, messageId: info.messageId };
}

export function otpEmailTemplate(name, otp) {
  return `
  <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4);padding:28px 24px">
      <h1 style="margin:0;color:#fff;font-size:22px">ChatConnect</h1>
    </div>
    <div style="padding:28px 24px">
      <p>Hi ${name || 'there'},</p>
      <p>Your verification code is:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#a5b4fc;text-align:center;margin:20px 0">${otp}</div>
      <p style="color:#94a3b8;font-size:13px">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
    </div>
  </div>`;
}

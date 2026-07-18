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

function makeTransport(port) {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/2525 = STARTTLS
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // Fail fast instead of hanging a request if the SMTP host is unreachable.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

// Some networks/hosts (notably cloud providers → GoDaddy relays) silently block
// one submission port but not the other. Try the configured port first, and on
// a CONNECTION-level failure (not auth/policy) retry once on the alternate
// (587 ↔ 465), then stick with whichever worked.
let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  transporter = makeTransport(Number(process.env.EMAIL_PORT) || 587);
  return transporter;
}

const CONNECTION_ERRORS = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'EDNS']);
function isConnectionError(err) {
  return CONNECTION_ERRORS.has(err?.code) || /timed?\s*out|connection/i.test(err?.message || '');
}

async function sendWithFallback(mail) {
  try {
    return await getTransport().sendMail(mail);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const primary = Number(process.env.EMAIL_PORT) || 587;
    const alternate = primary === 465 ? 587 : 465;
    console.warn(`⚠️  SMTP port ${primary} unreachable (${err.code || err.message}) — retrying on ${alternate}…`);
    const fallback = makeTransport(alternate);
    const info = await fallback.sendMail(mail); // throws to caller if this fails too
    transporter = fallback; // it worked — use this port from now on
    console.log(`✅ SMTP fallback to port ${alternate} succeeded.`);
    return info;
  }
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
 * The From header MUST contain an address on the authenticated account's domain
 * (GoDaddy/most SMTP relays reject otherwise — "550 mailfrom domain must match").
 * EMAIL_FROM may be a full "Name <addr>" or just a display name; when it has no
 * address we bind it to the authenticated mailbox.
 */
function fromHeader() {
  const raw = (process.env.EMAIL_FROM || '').trim().replace(/^"|"$/g, '');
  const user = process.env.EMAIL_USER || 'no-reply@chatconnect.app';
  if (raw.includes('@')) return raw; // already a full address / "Name <addr>"
  return `"${raw || 'ChatConnect'}" <${user}>`;
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
    // Never print the body (OTPs, reset links with raw tokens) to logs in
    // production — log access would otherwise hand out account-takeover material.
    if (process.env.NODE_ENV === 'production') {
      console.log('   Body:    [redacted — configure EMAIL_HOST/USER/PASS to actually send]\n');
    } else {
      console.log(`   Body:    ${text || html}\n`);
    }
    return { sent: false, logged: true };
  }
  const info = await sendWithFallback({
    from: fromHeader(),
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

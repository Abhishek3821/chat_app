import nodemailer from 'nodemailer';

/**
 * Sends an email via Nodemailer. If SMTP is not configured, it logs the
 * message to the console instead (handy for local dev / OTP testing).
 */
export async function sendEmail({ to, subject, html, text }) {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER) {
    console.log('\n📧 [Email disabled — logging instead]');
    console.log(`   To:      ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body:    ${text || html}\n`);
    return { logged: true };
  }

  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 587,
    secure: Number(EMAIL_PORT) === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  return transporter.sendMail({
    from: EMAIL_FROM || 'ChatConnect <no-reply@chatconnect.app>',
    to,
    subject,
    text,
    html,
  });
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

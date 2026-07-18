/**
 * SMS helper (login OTPs). Uses Twilio's REST API directly via fetch — no SDK
 * dependency. Configured with:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM  (a Twilio phone number)
 *
 * When SMS isn't configured the caller falls back to email, so login OTPs work
 * on any deployment.
 */

export function isSmsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** Send an SMS. Returns { sent: boolean }. Never throws on delivery problems. */
export async function sendSms({ to, body }) {
  if (!isSmsConfigured() || !to || !body) return { sent: false };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('❌ SMS send failed:', res.status, text.slice(0, 200));
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('❌ SMS send failed:', err.message);
    return { sent: false };
  }
}

/**
 * Normalize a phone number to a canonical form: an optional leading "+"
 * followed by 7–15 digits (E.164-ish). Returns '' when invalid.
 */
export function normalizePhone(v) {
  if (typeof v !== 'string') return '';
  const raw = v.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(raw)) return '';
  return raw;
}

/** Mask a phone for display: +9198••••••10 */
export function maskPhone(p) {
  if (!p || p.length < 6) return p || '';
  return `${p.slice(0, 4)}${'•'.repeat(Math.max(2, p.length - 6))}${p.slice(-2)}`;
}

/** Mask an email for display: ab•••@domain.com */
export function maskEmail(e) {
  const [local = '', domain = ''] = String(e || '').split('@');
  if (!domain) return e || '';
  return `${local.slice(0, 2)}•••@${domain}`;
}

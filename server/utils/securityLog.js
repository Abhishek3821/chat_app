/**
 * Minimal structured security-event logger (A09 — Security Logging & Monitoring).
 *
 * Emits one-line JSON to stdout so it can be scraped by any log aggregator
 * (Render logs, CloudWatch, Datadog, etc.). This is intentionally dependency-free
 * and always-on (unlike morgan, which we only enable in development). Swap the
 * transport here if you later add a dedicated logging service.
 *
 * Never log secrets (passwords, tokens, OTPs) — only the event, actor and outcome.
 */
export function securityEvent(event, req, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    kind: 'security',
    event, // e.g. 'login.success', 'login.failure', 'admin.user.status', 'password.change'
    ip: req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
    userId: req?.user?._id ? String(req.user._id) : meta.userId || null,
    ...meta,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

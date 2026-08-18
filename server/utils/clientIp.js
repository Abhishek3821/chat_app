/**
 * Resolve the real client IP for rate limiting.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every limiter used express-rate-limit's default key, `req.ip`. Behind the
 * production nginx that value was the SAME for every request, so the whole
 * internet shared one 1000-request bucket: a user who had done nothing was told
 * "Too many requests, please slow down" and could not sign in, because other
 * people's traffic had already spent the allowance.
 *
 * It was measurable from outside — a brand-new IP saw `RateLimit-Remaining: 580`
 * on its first ever request, and the counter fell by 186 in three seconds while
 * that client made exactly one call.
 *
 * `req.ip` only becomes the client when Express's `trust proxy` setting matches
 * the number of proxies actually in front of it AND every one of them forwards
 * the address. Guessing that number is fragile: adding a CDN silently breaks it,
 * and the failure mode is a single global bucket rather than an error.
 *
 * ── What this does ────────────────────────────────────────────────────────
 * Take the first header a known proxy sets, then fall back. Each of these is
 * written by the edge, not the client:
 *   1. `CF-Connecting-IP`  — Cloudflare, always the true client
 *   2. `True-Client-IP`    — Cloudflare Enterprise / Akamai
 *   3. `X-Real-IP`         — the usual nginx `proxy_set_header` value
 *   4. leftmost `X-Forwarded-For`
 *   5. `req.ip` / the raw socket address
 *
 * ── The limit of this, stated plainly ─────────────────────────────────────
 * If the proxy forwards NONE of these, no server-side code can recover the
 * client address — it never arrived. `describeIpResolution()` reports that at
 * boot so it is visible rather than silently degrading again.
 */

/** Strip an IPv6-mapped IPv4 prefix and any port, and normalise the case. */
function normalise(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let ip = raw.trim();
  if (!ip) return '';
  // "::ffff:203.0.113.7" → "203.0.113.7"
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  // "203.0.113.7:54321" → "203.0.113.7" (never split IPv6, which is full of colons)
  if (ip.includes('.') && ip.includes(':')) ip = ip.split(':')[0];
  return ip.toLowerCase();
}

const HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip'];

/**
 * The address to key a rate limiter on.
 * @param {import('express').Request} req
 * @returns {string} never empty — falls back to a constant so a limiter still works
 */
export function clientIp(req) {
  for (const h of HEADERS) {
    const v = normalise(req.headers?.[h]);
    if (v) return v;
  }
  // X-Forwarded-For is "client, proxy1, proxy2" — the CLIENT is leftmost.
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff) {
    const first = normalise(xff.split(',')[0]);
    if (first) return first;
  }
  return normalise(req.ip) || normalise(req.socket?.remoteAddress) || 'unknown';
}

/**
 * IPv6 addresses are handed out a /64 per customer, so keying on the exact
 * address lets one subscriber cycle through billions of keys. Bucket to the /64.
 */
export function rateLimitKey(req) {
  const ip = clientIp(req);
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':'); // /64
  return ip;
}

/**
 * One-line boot report: is the client address actually reaching us?
 *
 * Called on the first few requests rather than at startup, because the answer
 * lives in the headers a proxy sends — there is nothing to inspect until
 * traffic arrives.
 */
let reported = false;
export function reportIpResolutionOnce(req) {
  if (reported) return;
  reported = true;
  const seen = HEADERS.filter((h) => req.headers?.[h]);
  if (req.headers?.['x-forwarded-for']) seen.push('x-forwarded-for');
  if (seen.length) {
    console.log(`🌐 Client IP resolved from: ${seen.join(', ')} (rate limits are per client)`);
  } else {
    console.warn(
      '⚠️  No client-IP header on the first request (no X-Forwarded-For / X-Real-IP / CF-Connecting-IP).\n' +
        '   Every caller will therefore share ONE rate-limit bucket, and users will hit\n' +
        '   "Too many requests" for traffic that is not theirs.\n' +
        '   Fix it at the proxy, e.g. nginx:\n' +
        '     proxy_set_header X-Real-IP        $remote_addr;\n' +
        '     proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;'
    );
  }
}

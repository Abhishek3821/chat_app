import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis, redisDown } from '../utils/redis.js';
import { rateLimitKey, reportIpResolutionOnce } from '../utils/clientIp.js';

/**
 * Every limiter keys on the RESOLVED client address, not `req.ip`.
 *
 * `req.ip` is only the client when Express's `trust proxy` count happens to
 * match the proxies actually deployed. In production it did not, so `req.ip`
 * was one constant value and all traffic shared a single bucket — a fresh IP's
 * very first request already saw `RateLimit-Remaining: 580`, and people who had
 * done nothing were locked out of signing in. See utils/clientIp.js.
 *
 * `validate: { keyGeneratorIpFallback: false }` silences express-rate-limit's
 * warning about a custom key generator: the fallback it wants to add is exactly
 * the `req.ip` behaviour that caused this.
 */
const keyed = (extra = {}) => ({
  keyGenerator: (req) => {
    reportIpResolutionOnce(req);
    return rateLimitKey(req);
  },
  /* We read the forwarding headers ourselves (utils/clientIp.js), so switch off
     the two checks that assume the default `req.ip` key — they would otherwise
     warn on every request about a trust-proxy setup we deliberately bypass. */
  validate: { trustProxy: false, xForwardedForHeader: false },
  // A Redis outage must not take the API down with it: on a store error, let the
  // request through (un-limited) instead of answering 500.
  passOnStoreError: true,
  ...extra,
});

/**
 * Shared store when Redis is configured, so a fleet of instances enforces ONE
 * combined limit (and limits survive redeploys). Falls back to the per-process
 * in-memory store on a single box.
 */
function makeStore(prefix) {
  const r = getRedis();
  if (!r) return undefined; // express-rate-limit's default MemoryStore
  return new RedisStore({
    // While Redis is down, fail instantly; passOnStoreError lets the request through.
    sendCommand: (...args) => (redisDown() ? Promise.reject(new Error('Redis unavailable')) : r.call(...args)),
    prefix,
  });
}

/** Generous global limiter. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:api:'),
  ...keyed(),
  message: { success: false, message: 'Too many requests, please slow down.' },
});

/** Strict limiter for auth endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:auth:'),
  ...keyed(),
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' },
});

/* ── Brute-force limits keyed on WHAT is being guessed, not WHERE from ──────
   The IP limiters above key on forwarding headers (utils/clientIp.js), which a
   client can vary per request unless the edge proxy overwrites them. For
   endpoints that check a secret, add a second limit keyed on the target
   account / signed-in user: varying headers doesn't change that key, so
   password and PIN guessing stay capped either way. Only FAILED attempts count
   (skipSuccessfulRequests), so a user who types it right is never slowed. */
const secretGuard = (prefix, keyGenerator, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(prefix),
    keyGenerator,
    validate: { trustProxy: false, xForwardedForHeader: false },
    passOnStoreError: true,
    message: { success: false, message },
  });

/** Login: 10 failed attempts per ACCOUNT identifier per 15 minutes. */
export const loginAccountLimiter = secretGuard(
  'rl:login-acct:',
  (req) => {
    const id = req.body?.identifier ?? req.body?.email;
    // Normalise so "+1 555-0100" and "+15550100" share one bucket.
    const norm = typeof id === 'string' ? id.trim().toLowerCase().replace(/[\s()-]/g, '') : '';
    return norm ? `acct:${norm}` : `ip:${rateLimitKey(req)}`;
  },
  'Too many failed sign-in attempts for this account. Try again in 15 minutes.'
);

/**
 * PINs and passwords checked for a SIGNED-IN user (two-step PIN, chat-lock PIN,
 * meeting password, current password). Mount AFTER `protect`. A 4-digit PIN has
 * only 10,000 values, so this cap is what actually keeps it from being guessed.
 */
export const userSecretLimiter = secretGuard(
  'rl:secret:',
  (req) => (req.user?._id ? `user:${req.user._id}` : `ip:${rateLimitKey(req)}`),
  'Too many incorrect attempts. Try again in 15 minutes.'
);

/**
 * Incoming-webhook ingress (POST /api/hooks/:token) is unauthenticated by
 * design — the token IS the credential — so it must NOT rely on the generic
 * per-IP apiLimiter alone: a leaked token can be replayed from many source
 * IPs (never sharing the same IP bucket), and legitimate high-volume callers
 * (CI, monitoring) can share an IP/NAT with unrelated traffic. Keying on the
 * token itself caps abuse of ONE webhook without punishing every other
 * request from the same network.
 */
export const webhookIngressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // generous for CI/alerting bursts, tight enough to stop spam-flooding a group
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:hook:'),
  // The token IS the identity here; fall back to the resolved client address
  // rather than `req.ip`, for the same reason as every limiter above.
  keyGenerator: (req) => req.params.token || rateLimitKey(req),
  /* We read the forwarding headers ourselves (utils/clientIp.js), so switch off
     the two checks that assume the default `req.ip` key — they would otherwise
     warn on every request about a trust-proxy setup we deliberately bypass. */
  validate: { trustProxy: false, xForwardedForHeader: false },
  passOnStoreError: true,
  message: { success: false, message: 'This webhook is receiving too many requests. Slow down.' },
});

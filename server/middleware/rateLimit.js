import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../utils/redis.js';
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
  return new RedisStore({ sendCommand: (...args) => r.call(...args), prefix });
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
  message: { success: false, message: 'This webhook is receiving too many requests. Slow down.' },
});

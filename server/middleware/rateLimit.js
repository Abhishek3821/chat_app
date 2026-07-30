import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../utils/redis.js';

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
  message: { success: false, message: 'Too many requests, please slow down.' },
});

/** Strict limiter for auth endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:auth:'),
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
  keyGenerator: (req) => req.params.token || req.ip,
  message: { success: false, message: 'This webhook is receiving too many requests. Slow down.' },
});

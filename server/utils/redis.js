import Redis from 'ioredis';

/**
 * Redis is entirely OPTIONAL. With no REDIS_URL the whole app runs on a single
 * instance using in-memory presence / rate-limiting / inline jobs — exactly as
 * before. Set REDIS_URL and the Socket.IO adapter, shared rate-limit store,
 * cache and BullMQ worker all light up, making the backend horizontally
 * scalable behind a load balancer.
 */
let command = null;
let adapterPair = null;

export function redisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

/** Shared command client for cache / rate-limit / presence. Null when disabled. */
export function getRedis() {
  if (!redisEnabled()) return null;
  if (!command) {
    /* Fail FAST when Redis is unreachable. Every /api request goes through the
       Redis-backed rate limiter and cache; with ioredis defaults (20 retries per
       command, unlimited offline queue) a Redis outage made every request —
       even /health — hang for 25s+. One retry and a 2s command timeout let the
       limiter / cache fall back (they're fail-open) and the API stays up. */
    command = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 2000 });
    command.on('error', (e) => console.warn('⚠️  Redis:', e.message));
  }
  return command;
}

/**
 * True while the command client has LOST its connection (as opposed to still
 * booting). Hot paths (rate limiter, cache) skip Redis entirely in that state
 * so a Redis outage costs ~0ms per request instead of a timeout each.
 */
export function redisDown() {
  if (!command) return false;
  return command.status === 'reconnecting' || command.status === 'end' || command.status === 'close';
}

/**
 * A dedicated publisher/subscriber pair for the Socket.IO Redis adapter. The
 * adapter needs its own connections — the subscriber blocks, so it must never
 * share the command client.
 */
export function getAdapterPair() {
  if (!redisEnabled()) return null;
  if (!adapterPair) {
    const pub = new Redis(process.env.REDIS_URL);
    const sub = pub.duplicate();
    pub.on('error', (e) => console.warn('⚠️  Redis(pub):', e.message));
    sub.on('error', (e) => console.warn('⚠️  Redis(sub):', e.message));
    adapterPair = { pub, sub };
  }
  return adapterPair;
}

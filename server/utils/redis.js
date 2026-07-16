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
    command = new Redis(process.env.REDIS_URL);
    command.on('error', (e) => console.warn('⚠️  Redis:', e.message));
  }
  return command;
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

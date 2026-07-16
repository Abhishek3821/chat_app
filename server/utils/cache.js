import { getRedis } from './redis.js';

/**
 * Best-effort JSON cache backed by Redis. Every call is a no-op when Redis is
 * disabled, so callers can wrap hot read paths unconditionally.
 *
 * SECURITY NOTE: never cache the authenticated user in `protect` — session
 * revocation (tokenVersion) and ban/suspend checks must stay fresh. Use this
 * only for data that is safe to serve slightly stale (public profiles, chat
 * lists, workspace directories, …).
 */
export async function cacheGetJSON(key) {
  const r = getRedis();
  if (!r) return null;
  try {
    const v = await r.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJSON(key, value, ttlSeconds = 60) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* cache writes are best-effort */
  }
}

export async function cacheDel(...keys) {
  const r = getRedis();
  if (!r || !keys.length) return;
  try {
    await r.del(...keys);
  } catch {
    /* ignore */
  }
}

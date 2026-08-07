/**
 * Tiny in-process TTL cache — the fallback for facts worth remembering when
 * REDIS_URL isn't configured.
 *
 * Why this exists: `utils/cache.js` is a no-op without Redis, so caching added
 * there does nothing for the default single-instance deployment (render.yaml ships
 * `numInstances: 1`, and >1 instance already REQUIRES REDIS_URL for presence,
 * rate limiting and socket fan-out). That constraint is what makes a per-process
 * cache safe here: when Redis is absent there is exactly one process, so there is
 * no second cache to go stale against.
 *
 * Use ONLY for values where serving a slightly stale answer is harmless and the
 * TTL is short. Never for auth, session state, or anything security-bearing.
 */
const store = new Map(); // key -> { value, expires }

// Bounded so a pathological key space can't grow without limit; entries are
// evicted oldest-first (insertion order), which is adequate for TTL-scoped data.
const MAX_ENTRIES = 5000;

export function memoGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function memoSet(key, value, ttlSeconds) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export function memoDel(...keys) {
  for (const k of keys) store.delete(k);
}

/** Test/diagnostic helper. */
export function memoSize() {
  return store.size;
}

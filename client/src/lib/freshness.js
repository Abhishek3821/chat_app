/**
 * Skip a refetch that just happened.
 *
 * Every tab's page component calls its store's `load()` from a mount effect, so
 * navigating Chats → Communities → Chats → Communities refetched the same list
 * on each visit. React Router unmounts the page, so there's no component state
 * left to remember it — the guard has to live outside the component tree.
 *
 * Deliberately NOT a cache: nothing is stored here and the data still lives in
 * the store. This only answers "did we already ask, very recently?".
 *
 * Only use it where a stale list for a few seconds is harmless. Anything that a
 * socket event or a user action invalidates should call `markStale(key)` so the
 * next mount refetches immediately.
 */
const lastFetched = new Map();

export const DEFAULT_FRESH_MS = 30_000;

/** True when `key` was fetched within `withinMs` — i.e. skip the refetch. */
export function isFresh(key, withinMs = DEFAULT_FRESH_MS) {
  const t = lastFetched.get(key);
  return typeof t === 'number' && Date.now() - t < withinMs;
}

/** Record that `key` was just fetched. */
export function markFetched(key) {
  lastFetched.set(key, Date.now());
}

/** Force the next `isFresh(key)` to be false (after a write, or a socket event). */
export function markStale(key) {
  lastFetched.delete(key);
}

/** Clear everything — call on logout so the next session refetches from scratch. */
export function resetFreshness() {
  lastFetched.clear();
}

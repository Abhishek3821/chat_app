/**
 * The access token, held in MEMORY first and mirrored to localStorage.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHY MEMORY IS THE AUTHORITY
 * ════════════════════════════════════════════════════════════════════════
 * The token used to live only in `localStorage`, read directly from ~15 places.
 * That works fine first-party, and breaks the drop-in embed:
 *
 *   · a cross-site iframe gets PARTITIONED storage in current browsers, and in
 *     Safari (and Chrome with third-party storage blocked) it can be denied
 *     outright until the Storage Access API is granted;
 *   · `localStorage.setItem` then throws — or worse, appears to succeed and reads
 *     back null;
 *   · so the embed stored the token the host handed it, read back nothing, sent
 *     unauthenticated requests, got 401s, and sat on "Connecting…" forever.
 *
 * Nothing in that chain logs an error, which is the worst property a failure can
 * have. Keeping the token in a module variable removes the dependency entirely:
 * storage becomes a nice-to-have for surviving a page reload, not a requirement
 * for working at all.
 *
 * Order matters: memory wins when set, so the embed (which is handed a fresh
 * token by its host on every mount) never consults storage. A normal first-party
 * load starts with memory empty and falls back to localStorage, so an existing
 * session still survives a refresh exactly as before.
 */

const KEY = 'cc_token';

let memory = null;

/* Every storage touch is wrapped: in a partitioned or storage-denied context
   these THROW rather than returning null, and an uncaught throw here would take
   down the request interceptor and the socket handshake with it. */
function safeGet() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function safeSet(value) {
  try {
    localStorage.setItem(KEY, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — memory is already cleared by the caller */
  }
}

/** The current token, or null. Memory first, storage as a fallback. */
export function getToken() {
  return memory || safeGet();
}

/** Store a token. Persists when it can; always works in memory. */
export function setToken(value) {
  if (!value) return clearToken();
  memory = String(value);
  safeSet(memory);
  return memory;
}

/** Forget it everywhere. */
export function clearToken() {
  memory = null;
  safeRemove();
  return null;
}

/**
 * True when this context can actually persist. Only useful for diagnostics —
 * nothing should branch on it, because the memory path covers both cases.
 */
export function canPersistToken() {
  try {
    const probe = '__cc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

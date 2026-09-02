/**
 * The token store must keep working when `localStorage` is unavailable.
 *
 * This is the failure the drop-in embed hits: a cross-site iframe gets
 * partitioned storage, and in Safari (or Chrome with third-party storage blocked)
 * `localStorage` access THROWS. The token used to be read straight from storage in
 * ~15 places, so the embed stored what the host gave it, read back nothing, sent
 * unauthenticated requests, and sat on "Connecting…" with no error anywhere.
 *
 * Executed against a shim rather than a headless browser: the module touches three
 * storage methods and the interesting cases are exactly the ones a real browser
 * makes hard to reproduce on demand.
 *
 * Run from /client:  node test-token-store.mjs
 */
import fs from 'node:fs';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
};
const section = (t) => console.log(`\n— ${t}`);

const SRC = fs.readFileSync('src/lib/token.js', 'utf8');

/**
 * Load a fresh copy of the module with a given localStorage shim. Fresh because
 * the module keeps state, and each scenario must start clean.
 */
async function load(localStorageImpl) {
  const body = SRC.replace(/export function/g, 'function').replace(/export const/g, 'const');
  const factory = new Function(
    'localStorage',
    `${body}\nreturn { getToken, setToken, clearToken, canPersistToken };`
  );
  return factory(localStorageImpl);
}

const workingStore = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

/** Safari-style: every access throws a SecurityError. */
const deniedStore = () => ({
  getItem() {
    throw new Error('SecurityError: storage denied');
  },
  setItem() {
    throw new Error('SecurityError: storage denied');
  },
  removeItem() {
    throw new Error('SecurityError: storage denied');
  },
});

/** The nastier variant: writes appear to succeed, reads return nothing. */
const amnesiacStore = () => ({
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

(async () => {
  /* ── Normal first-party browser ──────────────────────────────────── */
  section('A browser where storage works');
  const ok = workingStore();
  let T = await load(ok);
  check('starts with no token', T.getToken() === null, String(T.getToken()));
  T.setToken('tok_first');
  check('setToken returns it', T.getToken() === 'tok_first');
  check('…and it is PERSISTED for a page reload', ok.map.get('cc_token') === 'tok_first', String(ok.map.get('cc_token')));
  check('canPersistToken reports true', T.canPersistToken() === true);

  /* A reload = a fresh module with the same storage. */
  const T2 = await load(ok);
  check('a fresh load recovers the token from storage', T2.getToken() === 'tok_first', String(T2.getToken()));

  T.clearToken();
  check('clearToken empties memory', T.getToken() === null);
  check('…and storage', !ok.map.has('cc_token'));

  /* ── The embed case: storage denied ──────────────────────────────── */
  section('A cross-site iframe where storage THROWS');
  T = await load(deniedStore());
  check('reading with no token does not throw', T.getToken() === null);
  let threw = null;
  try {
    T.setToken('tok_embed');
  } catch (e) {
    threw = e.message;
  }
  check('setToken does not throw', threw === null, String(threw));
  check('THE TOKEN IS STILL USABLE (memory)', T.getToken() === 'tok_embed', String(T.getToken()));
  check('canPersistToken correctly reports false', T.canPersistToken() === false);
  threw = null;
  try {
    T.clearToken();
  } catch (e) {
    threw = e.message;
  }
  check('clearToken does not throw', threw === null, String(threw));
  check('…and the token is gone', T.getToken() === null);

  /* ── The silent variant ──────────────────────────────────────────── */
  section('Storage that accepts writes and forgets them');
  T = await load(amnesiacStore());
  T.setToken('tok_ghost');
  check(
    'the token is still readable despite storage amnesia',
    T.getToken() === 'tok_ghost',
    'this is the case that produced 401s and an endless "Connecting…"'
  );

  /* ── Memory must WIN over stale storage ──────────────────────────── */
  section('Memory takes precedence over stale storage');
  const stale = workingStore();
  stale.map.set('cc_token', 'tok_OLD');
  T = await load(stale);
  check('with memory empty it falls back to storage', T.getToken() === 'tok_OLD');
  T.setToken('tok_ROTATED');
  check(
    'after a rotation the NEW token wins',
    T.getToken() === 'tok_ROTATED',
    'a host pushing a fresh token must not be overridden by a cached one'
  );
  check('and storage is updated too', stale.map.get('cc_token') === 'tok_ROTATED');

  /* ── Falsy inputs must clear, not store junk ─────────────────────── */
  section('Falsy input clears rather than storing junk');
  T = await load(workingStore());
  T.setToken('tok_x');
  T.setToken('');
  check("setToken('') clears", T.getToken() === null);
  T.setToken('tok_y');
  T.setToken(null);
  check('setToken(null) clears', T.getToken() === null);
  T.setToken('tok_z');
  T.setToken(undefined);
  check('setToken(undefined) clears', T.getToken() === null);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(58)}\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error('\nHARNESS CRASHED:', err);
  process.exit(1);
});

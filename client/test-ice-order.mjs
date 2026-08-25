#!/usr/bin/env node
/**
 * Which relay source wins, and when.
 *
 * `src/lib/iceServers.js` decides whether a call gets a relay at all, and it has
 * three possible sources with a strict order between them. Getting that order
 * wrong does not throw — it silently picks the worse source, or none, and the
 * only symptom is a call that connects and carries no audio. Nothing else in the
 * suite covers it, because it is browser code with no backend to assert against.
 *
 * The module is Vite source: it reads `import.meta.env` and imports the axios
 * wrapper. Rather than restructure the module for testability, this rewrites
 * those two things the way Vite itself would — a define and a module stub — and
 * then exercises the real logic.
 *
 *   node test-ice-order.mjs        (from /client)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'src', 'lib', 'iceServers.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const section = (t) => console.log(`\n— ${t}`);

/* ── Load the real module with Vite's two substitutions ──────────────── */

let counter = 0;
async function loadModule(env) {
  const src = fs
    .readFileSync(SRC, 'utf8')
    // `import api from './api'` → the stub the test controls.
    .replace(/^import api from '\.\/api';$/m, 'const api = globalThis.__ICE_API;')
    // Vite replaces import.meta.env at build time; do the same.
    .replace(/import\.meta\.env/g, 'globalThis.__ICE_ENV');

  globalThis.__ICE_ENV = { DEV: false, ...env };
  const file = path.join(os.tmpdir(), `ice-order-${process.pid}-${counter++}.mjs`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

/** A relay entry as a provider would return it. */
const relay = (host, username = 'u', credential = 'c') => ({ urls: [`turn:${host}:3478`], username, credential });

/* ── Scenarios ───────────────────────────────────────────────────────── */

let serverCalls = 0;
let fetchCalls = 0;
let fetchUrl = null;

function stubServer(behaviour) {
  globalThis.__ICE_API = {
    get: async () => {
      serverCalls += 1;
      return behaviour();
    },
  };
}
function stubFetch(behaviour) {
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    fetchUrl = String(url);
    return behaviour();
  };
}
const reset = () => {
  serverCalls = 0;
  fetchCalls = 0;
  fetchUrl = null;
};

const THIRD_PARTY = 'https://tenant.metered.live/api/v1/turn/credentials?apiKey=SECRET123';

/* 1 — the good path */
section('The server can mint credentials');
reset();
stubServer(() => ({ data: { iceServers: [relay('server.relay')], ttlSeconds: 3600, relay: 'configured' } }));
stubFetch(() => { throw new Error('must not be called'); });
let m = await loadModule({ VITE_TURN_CREDENTIALS_URL: THIRD_PARTY });
await m.ensureIceServers();
check('the server is asked', serverCalls === 1, String(serverCalls));
check('a relay is loaded', m.hasRelay());
check('it is the server one', JSON.stringify(m.ICE_SERVERS).includes('server.relay'));
check(
  'the build-time URL is NOT used when the server works',
  fetchCalls === 0,
  `${fetchCalls} — using it anyway would keep a provider key in the bundle for no reason`
);

/* 2 — the deployment this exists for */
section('The server has no endpoint yet (404) — the bridge carries the call');
reset();
stubServer(() => { const e = new Error('Request failed with status code 404'); e.response = { status: 404 }; throw e; });
stubFetch(async () => ({ ok: true, json: async () => [relay('fallback.relay')] }));
m = await loadModule({ VITE_TURN_CREDENTIALS_URL: THIRD_PARTY });
await m.ensureIceServers();
check('the server was still tried first', serverCalls === 1, String(serverCalls));
check('then the build-time URL', fetchCalls === 1 && fetchUrl === THIRD_PARTY, fetchUrl || 'not called');
check('a relay is loaded', m.hasRelay());

/* 3 — deployed, but no provider configured */
section('The server answers but offers no relay (stun_only)');
reset();
stubServer(() => ({ data: { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], relay: 'stun_only', ttlSeconds: 3600 } }));
stubFetch(async () => ({ ok: true, json: async () => [relay('fallback.relay')] }));
m = await loadModule({ VITE_TURN_CREDENTIALS_URL: THIRD_PARTY });
await m.ensureIceServers();
check(
  'a STUN-only answer counts as no relay, so the bridge is used',
  fetchCalls === 1,
  `${fetchCalls} — a 200 with no relay is not success`
);
check('a relay is loaded', m.hasRelay());

/* 4 — nothing anywhere */
section('Neither source has anything');
reset();
stubServer(() => { throw new Error('Network Error'); });
stubFetch(() => { throw new Error('must not be called'); });
m = await loadModule({});
const list = await m.ensureIceServers();
check('it resolves rather than rejecting', Array.isArray(list));
check('no relay is claimed', !m.hasRelay());
check('STUN survives, so same-network calls still work', list.length >= 1, String(list.length));
check(
  'the failure message names the missing relay, not "the network"',
  /relay server/.test(m.callFailureMessage()),
  m.callFailureMessage()
);

/* 5 — the explicit override */
section('A static VITE_TURN_URL is the operator overriding everything');
reset();
stubServer(() => ({ data: { iceServers: [relay('server.relay')], ttlSeconds: 3600 } }));
stubFetch(async () => ({ ok: true, json: async () => [relay('fallback.relay')] }));
m = await loadModule({ VITE_TURN_URL: 'turn:static.relay:3478', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'c', VITE_TURN_CREDENTIALS_URL: THIRD_PARTY });
await m.ensureIceServers();
check('neither source is consulted', serverCalls === 0 && fetchCalls === 0, `server ${serverCalls}, fetch ${fetchCalls}`);
check('the static relay is what is used', JSON.stringify(m.ICE_SERVERS).includes('static.relay'));

/* 6 — the failure that made the ordering matter */
section('A failed attempt must not be cached as success');
reset();
let mode = 'fail';
stubServer(() => {
  if (mode === 'fail') throw new Error('Network Error');
  return { data: { iceServers: [relay('server.relay')], ttlSeconds: 3600 } };
});
stubFetch(() => { throw new Error('no fallback configured'); });
m = await loadModule({});
await m.ensureIceServers();
check('first attempt found nothing', !m.hasRelay());
mode = 'ok';
await m.ensureIceServers();
check(
  'the next call start tries again instead of staying dead',
  m.hasRelay() && serverCalls === 2,
  `${serverCalls} attempts — caching the failure would leave a tab relay-less until reload`
);

/* 7 — de-duplication across refreshes */
section('Refreshing does not stack duplicate entries');
reset();
stubServer(() => ({ data: { iceServers: [relay('server.relay')], ttlSeconds: 3600 } }));
stubFetch(() => { throw new Error('must not be called'); });
m = await loadModule({});
await m.ensureIceServers();
m.resetIceServers();
await m.ensureIceServers();
const relayEntries = m.ICE_SERVERS.filter((s) => JSON.stringify(s.urls).includes('server.relay'));
check(
  'one entry per relay, not one per refresh',
  relayEntries.length === 1,
  `${relayEntries.length} — duplicates slow ICE gathering on every later call`
);

/* ── done ────────────────────────────────────────────────────────────── */

const passed = results.filter(Boolean).length;
console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);

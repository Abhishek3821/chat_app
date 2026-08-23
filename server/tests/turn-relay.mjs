/**
 * TURN relay readiness — can two people on different networks actually talk?
 *
 * Chat always works (the server relays it). CALLS are peer-to-peer, and a direct
 * path is impossible when both sides sit behind symmetric NAT or CGNAT — mobile
 * carriers, most office networks, a lot of hotel wifi. Those calls ring, both
 * sides accept, and then there is no media and it drops: a failure that looks
 * like an app bug rather than a missing deployment setting.
 *
 * So this suite asserts both halves of the contract:
 *   • with TURN_URL + TURN_SECRET set, `/api/v1/ice` hands the browser
 *     time-limited relay credentials;
 *   • without them it degrades to STUN and SAYS so, rather than pretending a
 *     relay exists.
 *
 * Credentials use coturn's `use-auth-secret` scheme: username is
 * `<unix-expiry>:<scope>` and credential is base64(HMAC-SHA1(username, secret)).
 * The shared secret itself must never reach the browser — checked below.
 *
 * Complements embed-dropin.mjs, which covers the EMBED surface
 * (`/v1/embed/ice`). This one covers the FIRST-PARTY app path (`/v1/ice`) and
 * the not-configured case, which nothing else asserts.
 *
 * Run:  node tests/turn-relay.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5141;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env — cannot run.'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_turn$2');
if (TEST_URI === baseUri) { console.error('Refusing to run: could not derive an isolated test database name.'); process.exit(1); }

const TURN_URLS = 'turn:relay.test:3478?transport=udp,turns:relay.test:5349';
const TURN_SECRET = 'shared-secret-for-this-test-only';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n— ${t}`);

let proc = null;
const bootLog = [];
async function boot(extraEnv) {
  bootLog.length = 0;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), MONGO_URI: TEST_URI, NODE_ENV: 'development', ENABLE_EMAIL_VERIFICATION: 'false', CLIENT_URL: 'http://localhost:5290', TURN_URL: '', TURN_SECRET: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => bootLog.push(String(d)));
  proc.stderr.on('data', (d) => bootLog.push(String(d)));
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/health`)).ok) { await sleep(300); return; } } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}
async function stop() { proc?.kill(); proc = null; await sleep(500); }
async function finish(code) {
  await stop();
  try { await mongoose.disconnect(); } catch { /* noop */ }
  try { cfServer.close(); } catch { /* noop */ }
  process.exit(code);
}

let seq = 0;
async function signIn() {
  const stamp = `${Date.now()}${seq++}`;
  const password = 'Passw0rd!23';
  const res = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Relay Tester', username: `relay${stamp}`, email: `relay${stamp}@test.local`,
      password, confirmPassword: password, phone: `+1555${String(9_100_000 + seq).slice(0, 7)}`,
    }),
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`signup failed (${res.status}): ${data?.message}`);
  return data.accessToken || data.token;
}
const iceFor = async (token) => {
  const res = await fetch(`${API}/v1/ice`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
/* ── A stand-in for Cloudflare's TURN API ──────────────────────────────
   Cloudflare does not use coturn's HMAC scheme: credentials come from an
   authenticated POST, so the only way to test that path is to answer it. This
   records what the server actually SENT (auth header, key id in the path, ttl
   body), which is the half a mocked-out unit test would miss — a wrong header
   shape fails identically to a wrong secret. */
const CF_PORT = 5142;
const CF_BASE = 'http://127.0.0.1:' + CF_PORT + '/v1/turn';
const CF_KEY_ID = 'cf-key-id-for-test';
const CF_TOKEN = 'cf-api-token-never-send-to-a-browser';
const CF_USER = '1a2b3c-generated-username';
const CF_CRED = 'generated-credential-not-an-hmac';

const cfHits = [];
let cfMode = 'ok'; // 'ok' | 'legacy' | 'unauthorized'

const cfServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    cfHits.push({ url: req.url, auth: String(req.headers.authorization || ''), body });
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (cfMode === 'unauthorized') return send(401, { errors: [{ message: 'invalid token' }] });

    const isNewApi = req.url.endsWith('/credentials/generate-ice-servers');
    // The legacy account shape: only the older path exists.
    if (cfMode === 'legacy' && isNewApi) return send(404, { errors: [{ message: 'not found' }] });

    const entry = {
      urls: ['stun:stun.cf.test:3478', 'turn:turn.cf.test:3478?transport=udp', 'turns:turn.cf.test:5349?transport=tcp'],
      username: CF_USER,
      credential: CF_CRED,
    };
    // Current API returns an array; the older one a bare object. Both are real.
    return send(200, { iceServers: isNewApi ? [entry] : entry });
  });
});
const cfEnv = { CLOUDFLARE_TURN_KEY_ID: CF_KEY_ID, CLOUDFLARE_TURN_API_TOKEN: CF_TOKEN, CLOUDFLARE_TURN_API_BASE: CF_BASE };

const relaysIn = (body) => {
  const list = Array.isArray(body?.iceServers) ? body.iceServers : Array.isArray(body) ? body : [];
  return list.filter((s) => /^turns?:/.test(String(Array.isArray(s.urls) ? s.urls[0] : s.urls)));
};

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  /* Start clean. Without this the second run reuses the first run's accounts and
     signup fails on the unique phone index — the suite passed once and then
     crashed forever after, which is worse than never passing. */
  await new Promise((r) => cfServer.listen(CF_PORT, '127.0.0.1', r));
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();

  /* ── Configured ─────────────────────────────────────────────────── */
  section('With TURN_URL + TURN_SECRET set');
  await boot({ TURN_URL: TURN_URLS, TURN_SECRET });
  check('boot says the relay is configured', /TURN relay configured/.test(bootLog.join('\n')), bootLog.join('').slice(-140));

  const token = await signIn();
  const got = await iceFor(token);
  check('GET /api/v1/ice succeeds for a signed-in user', got.status === 200, String(got.status));

  const relays = relaysIn(got.body);
  check('a relay is offered to the browser', relays.length === 1, `${relays.length} relay entr(ies)`);
  check(
    'both transports are included (UDP and TLS)',
    JSON.stringify(relays[0]?.urls || []).includes('turn:') && JSON.stringify(relays[0]?.urls || []).includes('turns:'),
    JSON.stringify(relays[0]?.urls)
  );
  check('STUN is still offered alongside it', relaysIn(got.body).length < (got.body.iceServers || []).length);

  section('The credentials are time-limited and correctly signed');
  const [expiry, scope] = String(relays[0]?.username || '').split(':');
  check('username is <unix-expiry>:<scope>', /^\d+$/.test(expiry) && !!scope, relays[0]?.username);
  const secondsOut = Number(expiry) - Math.floor(Date.now() / 1000);
  check('it expires in the future, within a day', secondsOut > 60 && secondsOut <= 24 * 3600, `${secondsOut}s`);
  const expected = crypto.createHmac('sha1', TURN_SECRET).update(relays[0].username).digest('base64');
  check('credential is HMAC-SHA1(username, secret) — coturn use-auth-secret', relays[0].credential === expected);

  section('The shared secret never leaves the server');
  const raw = JSON.stringify(got.body);
  check('the response does not contain TURN_SECRET', !raw.includes(TURN_SECRET));

  section('Credentials are per user, not one shared pair');
  const other = await iceFor(await signIn());
  check('a different user gets a different username scope', relaysIn(other.body)[0]?.username !== relays[0].username, relaysIn(other.body)[0]?.username);

  section('It requires a session');
  const anon = await fetch(`${API}/v1/ice`);
  check('no token → 401, so relay bandwidth cannot be harvested anonymously', anon.status === 401, String(anon.status));

  /* ── A NETWORK of relays ────────────────────────────────────────── */
  section('A pool of relays, one shared secret');
  await stop();
  await boot({
    TURN_URL: 'turn:a.relay.test:3478 | turn:b.relay.test:3478,turns:b.relay.test:5349',
    TURN_SECRET,
  });
  const poolLog = bootLog.join('\n');
  check('boot reports how many relays', /2 relays via self-hosted, tried in the order listed/.test(poolLog), poolLog.slice(-160));
  const poolRelays = relaysIn((await iceFor(await signIn())).body);
  check('one ICE entry per relay group', poolRelays.length === 2, String(poolRelays.length));
  check('the shared secret signs both identically', poolRelays[0].credential === poolRelays[1].credential);
  check('order is preserved, so the nearest relay can be listed first', String(poolRelays[0].urls[0]).includes('a.relay'), JSON.stringify(poolRelays[0].urls));
  check('a group keeps all of its own transports', poolRelays[1].urls.length === 2, JSON.stringify(poolRelays[1].urls));

  section('Independent secrets per region — one leak does not expose the rest');
  await stop();
  await boot({
    TURN_URL: 'turn:in.relay.test:3478 | turn:eu.relay.test:3478 | turn:us.relay.test:3478',
    TURN_SECRET: 'sec-in | sec-eu | sec-us',
  });
  check('boot reports three relays', /3 relays/.test(bootLog.join('\n')), bootLog.join('').slice(-140));
  const regRelays = relaysIn((await iceFor(await signIn())).body);
  check('three entries', regRelays.length === 3, String(regRelays.length));
  const uname = regRelays[0] ? regRelays[0].username : '';
  const signedRight = ['sec-in', 'sec-eu', 'sec-us'].every(
    (sec, i) => regRelays[i] && regRelays[i].credential === crypto.createHmac('sha1', sec).update(uname).digest('base64')
  );
  check('each is signed with ITS OWN secret, so every coturn accepts its own', signedRight);
  check('the three credentials differ', new Set(regRelays.map((r) => r.credential)).size === 3);
  check('no secret appears anywhere in the payload', !['sec-in', 'sec-eu', 'sec-us'].some((x) => JSON.stringify(regRelays).includes(x)));

  section('Mismatched counts drop the group rather than mis-sign it');
  await stop();
  await boot({
    TURN_URL: 'turn:a.relay.test:3478 | turn:b.relay.test:3478 | turn:c.relay.test:3478',
    TURN_SECRET: 'sec-a | sec-b',
  });
  check(
    'boot WARNS about the mismatch',
    /TURN config: .*3 relay group\(s\) but TURN_SECRET has 2/.test(bootLog.join('\n')),
    bootLog.join('').slice(-220)
  );
  const partial = relaysIn((await iceFor(await signIn())).body);
  check(
    'the unmatched relay is omitted, never signed with the wrong secret',
    partial.length === 2,
    String(partial.length) + ' — a credential the relay rejects wastes ICE time and reads as a dead relay'
  );

  /* ── Cloudflare TURN, the managed alternative ───────────────────── */
  section('Cloudflare TURN alone — for an operator with no relay of their own');
  await stop();
  cfMode = 'ok';
  cfHits.length = 0;
  await boot(cfEnv);
  check('boot names the provider', /via cloudflare/.test(bootLog.join('\n')), bootLog.join('').slice(-200));

  const cfIce = await iceFor(await signIn());
  const cfRelays = relaysIn(cfIce.body);
  check('a relay is offered', cfRelays.length === 1, String(cfRelays.length));
  check('it carries the credentials the API generated', cfRelays[0]?.username === CF_USER && cfRelays[0]?.credential === CF_CRED, JSON.stringify(cfRelays[0]));
  check(
    "Cloudflare's own STUN entry is dropped, since STUN is already first",
    !JSON.stringify(cfRelays).includes('stun:stun.cf.test'),
    JSON.stringify(cfRelays[0]?.urls)
  );
  check('status reports the provider', JSON.stringify(cfIce.body.providers) === JSON.stringify(['cloudflare']), JSON.stringify(cfIce.body.providers));

  section('The API token is an account credential — it must never travel');
  check('the token is not in the response', !JSON.stringify(cfIce.body).includes(CF_TOKEN));
  check('the key id is not in the response either', !JSON.stringify(cfIce.body).includes(CF_KEY_ID));
  check('the server sent it as a Bearer header', cfHits[0]?.auth === 'Bearer ' + CF_TOKEN, cfHits[0]?.auth);
  check('the key id went in the path, as the API requires', String(cfHits[0]?.url || '').includes('/keys/' + CF_KEY_ID + '/'), cfHits[0]?.url);
  check('a ttl was requested, so the credential expires on its own', Number(JSON.parse(cfHits[0]?.body || '{}').ttl) >= 3600, cfHits[0]?.body);

  section('The advertised ttl must not outlive the credential');
  check(
    'ttlSeconds never exceeds the life the credential was minted with',
    cfIce.body.ttlSeconds > 0 && cfIce.body.ttlSeconds <= Number(JSON.parse(cfHits[0]?.body || '{}').ttl),
    cfIce.body.ttlSeconds + ' vs minted ' + JSON.parse(cfHits[0]?.body || '{}').ttl,
  );

  section('Credentials are cached — not one upstream call per call started');
  const hitsBefore = cfHits.length;
  await iceFor(await signIn());
  await iceFor(await signIn());
  check(
    'three /ice requests, still one upstream request',
    cfHits.length === hitsBefore,
    cfHits.length - hitsBefore + ' extra — every call start would hit a rate limit and add latency'
  );

  section('Both providers at once — own relay first, Cloudflare as the fallback');
  await stop();
  cfHits.length = 0;
  await boot({ TURN_URL: TURN_URLS, TURN_SECRET, ...cfEnv });
  check('boot names both', /via self-hosted \+ cloudflare/.test(bootLog.join('\n')), bootLog.join('').slice(-200));
  const bothIce = await iceFor(await signIn());
  const bothRelays = relaysIn(bothIce.body);
  check('two relay entries', bothRelays.length === 2, String(bothRelays.length));
  check(
    'the self-hosted relay is tried FIRST — it is yours and it is cheaper',
    JSON.stringify(bothRelays[0]?.urls).includes('relay.test'),
    JSON.stringify(bothRelays[0]?.urls)
  );
  check('Cloudflare is the second choice, not the first', JSON.stringify(bothRelays[1]?.urls).includes('turn.cf.test'), JSON.stringify(bothRelays[1]?.urls));
  check(
    'the self-hosted entry is still a locally-signed HMAC',
    bothRelays[0]?.credential === crypto.createHmac('sha1', TURN_SECRET).update(String(bothRelays[0]?.username)).digest('base64')
  );
  check('relayCount counts both providers', bothIce.body.relayCount === 2, String(bothIce.body.relayCount));

  section('A bad token must not take the call down with it');
  await stop();
  cfMode = 'unauthorized';
  cfHits.length = 0;
  await boot({ TURN_URL: TURN_URLS, TURN_SECRET, ...cfEnv });
  const degraded = await iceFor(await signIn());
  check('the endpoint still answers 200, not 500', degraded.status === 200, String(degraded.status));
  const degradedRelays = relaysIn(degraded.body);
  check(
    'the self-hosted relay is unaffected by the failing provider',
    degradedRelays.length === 1 && JSON.stringify(degradedRelays[0].urls).includes('relay.test'),
    JSON.stringify(degradedRelays)
  );
  check('the failure is logged once so the operator can see it', /Cloudflare TURN unavailable/.test(bootLog.join('\n')), bootLog.join('').slice(-200));

  section('Cloudflare with NO own relay and a bad token — STUN, honestly');
  await stop();
  cfMode = 'unauthorized';
  await boot(cfEnv);
  const cfDead = await iceFor(await signIn());
  check('still answers', cfDead.status === 200, String(cfDead.status));
  check('no relay is invented', relaysIn(cfDead.body).length === 0, JSON.stringify(relaysIn(cfDead.body)));
  check('STUN is still returned', (cfDead.body.iceServers || []).length >= 1);

  section('The older API shape still works');
  await stop();
  cfMode = 'legacy';
  cfHits.length = 0;
  await boot(cfEnv);
  const legacy = await iceFor(await signIn());
  check('the new path is tried first', String(cfHits[0]?.url || '').endsWith('/credentials/generate-ice-servers'), cfHits[0]?.url);
  check('a 404 there falls back to the older path', String(cfHits[1]?.url || '').endsWith('/credentials/generate'), cfHits[1]?.url);
  check(
    'the single-object response is read the same as the array one',
    relaysIn(legacy.body)[0]?.credential === CF_CRED,
    JSON.stringify(relaysIn(legacy.body))
  );

  /* ── Not configured ─────────────────────────────────────────────── */
  section('With TURN unset — degrade honestly, never pretend');
  await stop();
  await boot({});
  check('boot WARNS that there is no relay', /No TURN relay \(STUN only\)/.test(bootLog.join('\n')), bootLog.join('').slice(-160));
  const stunOnly = await iceFor(await signIn());
  check('the endpoint still answers', stunOnly.status === 200, String(stunOnly.status));
  check('no relay is claimed', relaysIn(stunOnly.body).length === 0, JSON.stringify(relaysIn(stunOnly.body)));
  check('STUN is still returned so same-network calls work', (stunOnly.body.iceServers || stunOnly.body || []).length >= 1);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

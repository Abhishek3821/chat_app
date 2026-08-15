/**
 * Presence — "online" must mean the app is open RIGHT NOW.
 *
 * Reported bug: everyone showed online all the time. Three causes, all pinned
 * below:
 *   1. `isOnline` was a persisted boolean flipped on connect/disconnect, and
 *      NOTHING reset it at boot. Every crash, deploy or dev-server restart
 *      stranded `isOnline: true` on whoever was connected — permanently.
 *   2. A socket outlives the app being open (backgrounded tab, sleeping laptop,
 *      half-open connection), so "socket attached" was never the right test.
 *   3. There was no idle rule at all: a tab left open kept you lit for days.
 *
 * Presence is now derived from a heartbeat: online iff `lastSeen` is within
 * PRESENCE_TTL_MS. The pure rules are checked directly; the boot reset and the
 * live socket flow are checked against a real server.
 *
 * Run:  node tests/presence.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5125;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_presence$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n— ${t}`);

async function http(method, url, { token, body } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

let serverProc = null;
const bootLog = [];
async function startServer() {
  bootLog.length = 0;
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      CLIENT_URL: 'http://localhost:5290',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => bootLog.push(String(d)));
  serverProc.stderr.on('data', (d) => bootLog.push(String(d)));
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${API}/health`)).ok) {
        await sleep(400);
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}
async function stopServer() {
  serverProc?.kill();
  serverProc = null;
  await sleep(500);
}

const sockets = [];
async function finish(code) {
  sockets.forEach((s) => s.close());
  await stopServer();
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  process.exit(code);
}

function connect(token) {
  const s = ioClient(BASE, { auth: (cb) => cb({ token }), transports: ['websocket'], reconnection: false, timeout: 8000 });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_600_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag.toUpperCase()} Tester`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name };
}

async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}

(async () => {
  if (TEST_URI.includes('+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      /* noop */
    }
  }

  /* ── The staleness rule itself ──────────────────────────────────── */
  const { isPresenceFresh, applyPresenceFreshness, PRESENCE_TTL_MS } = await import('../utils/presence.js');
  section('The rule: online means a heartbeat within the window');
  check('the window is 5 minutes', PRESENCE_TTL_MS === 5 * 60 * 1000, `${PRESENCE_TTL_MS}ms`);
  check('a heartbeat from just now is online', isPresenceFresh({ isOnline: true, lastSeen: new Date() }));
  check(
    'a heartbeat from 4 minutes ago is still online',
    isPresenceFresh({ isOnline: true, lastSeen: new Date(Date.now() - 4 * 60 * 1000) })
  );
  check(
    'a heartbeat from 6 minutes ago is NOT',
    !isPresenceFresh({ isOnline: true, lastSeen: new Date(Date.now() - 6 * 60 * 1000) })
  );
  check('a flag with no timestamp at all is not trusted', !isPresenceFresh({ isOnline: true }));
  check('isOnline:false is never resurrected by a fresh timestamp', !isPresenceFresh({ isOnline: false, lastSeen: new Date() }));
  const stale = applyPresenceFreshness({ isOnline: true, lastSeen: new Date(Date.now() - 10 * 60 * 1000) });
  check('serialising a stale row flips the dot off', stale.isOnline === false);

  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();
  const users = mongoose.connection.db.collection('users');
  const rowOf = (id) => users.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });

  const A = await makeUser('presa');
  const B = await makeUser('presb');
  await befriend(A, B);

  /* ── Cause 1: the flag that never got cleared ───────────────────── */
  section('A restart clears "online" left behind by the previous run');
  // Exactly what a crash leaves behind: online flags with nobody connected.
  await users.updateMany({}, { $set: { isOnline: true, lastSeen: new Date() } });
  check('(setup) everyone is marked online with no sockets', (await users.countDocuments({ isOnline: true })) >= 2);
  await stopServer();
  await startServer();
  check(
    'after a reboot nobody is left online',
    (await users.countDocuments({ isOnline: true })) === 0,
    `${await users.countDocuments({ isOnline: true })} still online`
  );
  check('and the boot log says so', /Presence reset: \d+ stale/.test(bootLog.join('\n')), bootLog.join('').slice(-160));

  /* ── The live path ──────────────────────────────────────────────── */
  section('Opening the app marks you online; closing it marks you offline');
  const sa = await connect(A.token);
  await sleep(600);
  check('connecting sets online', (await rowOf(A.id))?.isOnline === true);
  check('and stamps a fresh lastSeen', Date.now() - new Date((await rowOf(A.id)).lastSeen).getTime() < 10_000);

  const seenByContact = await http('GET', '/users/me/contacts', { token: B.token });
  check(
    'their contact sees the dot',
    (seenByContact.data?.contacts || []).find((c) => String(c._id) === String(A.id))?.isOnline === true,
    JSON.stringify((seenByContact.data?.contacts || []).map((c) => [c.name, c.isOnline]))
  );

  sa.close();
  await sleep(900);
  check('closing the app marks them offline', (await rowOf(A.id))?.isOnline === false);
  const afterClose = await http('GET', '/users/me/contacts', { token: B.token });
  check(
    'and the contact list agrees',
    (afterClose.data?.contacts || []).find((c) => String(c._id) === String(A.id))?.isOnline === false
  );

  /* ── Cause 2+3: a socket that outlives the app being open ───────── */
  section('A connected-but-idle user reads as offline once the window passes');
  const sa2 = await connect(A.token);
  await sleep(600);
  check('(setup) online again with a live socket', (await rowOf(A.id))?.isOnline === true);
  // Backdate the heartbeat: this is a tab left open with nobody there, which is
  // indistinguishable to the server from a sleeping laptop. The socket is STILL
  // CONNECTED throughout — that is the point.
  await users.updateOne(
    { _id: new mongoose.Types.ObjectId(String(A.id)) },
    { $set: { lastSeen: new Date(Date.now() - 10 * 60 * 1000) } }
  );
  check('the socket is still connected', sa2.connected);
  const idleRead = await http('GET', '/users/me/contacts', { token: B.token });
  check(
    'reads report them offline anyway (derived, not swept)',
    (idleRead.data?.contacts || []).find((c) => String(c._id) === String(A.id))?.isOnline === false,
    'a live socket must not keep an idle user lit'
  );
  const profile = await http('GET', `/users/${A.id}`, { token: B.token });
  check('the profile endpoint agrees', profile.data?.user?.isOnline === false, JSON.stringify(profile.data?.user?.isOnline));

  section('A heartbeat brings them straight back');
  sa2.emit('presence:ping');
  await sleep(700);
  const revived = await http('GET', '/users/me/contacts', { token: B.token });
  check(
    'one ping and the dot is back',
    (revived.data?.contacts || []).find((c) => String(c._id) === String(A.id))?.isOnline === true
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

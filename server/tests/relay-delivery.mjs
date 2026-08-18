/**
 * Why did a 1:1 `call:offer` never arrive while `presence-snapshot` did?
 *
 * A live re-test reported: provisioning + contact accept + POST /calls/start all
 * succeed (201, real Call doc) — but the doc comes back `status: "missed"`, the
 * callee never receives `call:offer`, and `typing-start` is equally never
 * relayed. Only `presence-snapshot` lands. That was read as a dead relay.
 *
 * A dead relay does not explain the asymmetry, so this pins down what does.
 * Three scenarios, each isolating one layer:
 *
 *   1. ONE instance, the exact reported path. If the offer arrives here, the
 *      relay code is not dead and the fault is environmental.
 *   2. The typing guard. `typing-start` relays to `chat:<id>`, and a socket is
 *      only in that room after `join-chat` passed a membership check. A harness
 *      that skips `join-chat` gets silence — by design, not by breakage.
 *   3. TWO instances sharing one database with REDIS_URL unset — a load-balanced
 *      deploy. `emitToUser` targets the `user:<id>` room, which without the
 *      Redis adapter exists only on the process the callee is connected to, and
 *      `isUserOnline` falls back to a process-local Map. Predicted result: the
 *      exact reported triad — "missed", no offer, presence fine.
 *
 * Run:  node tests/relay-delivery.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT_A = 5131; // "instance 1"
const PORT_B = 5132; // "instance 2" — same DB, no shared adapter
const api = (port) => `http://127.0.0.1:${port}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_relay$2');
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

async function http(port, method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${api(port)}${url}`, {
    method,
    headers,
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

const procs = [];
async function startServer(port) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      CLIENT_URL: 'http://localhost:5290',
      REDIS_URL: '', // the condition under test in scenario 3
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error(`[server:${port}]`, s.trim().slice(0, 200));
  });
  procs.push(proc);
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${api(port)}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`Server on ${port} did not become healthy in time.`);
}

async function finish(code) {
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  procs.forEach((p) => p.kill());
  await sleep(250);
  process.exit(code);
}

let seq = 0;
async function signup(port, tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const { status, data } = await http(port, 'POST', '/auth/signup', {
    body: {
      name: `${tag} User`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+1555${String(9_700_000 + seq++).slice(0, 7)}`,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: `${tag} User` };
}

const connect = (port, token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

/** NULL on timeout — a missing relay must read as a failure, never as a hang. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/**
 * Mutual contacts, via the real request/accept flow — which is what `canSignal`
 * requires. `POST /users/me/contacts/:id` is a one-sided add and does NOT
 * satisfy it, so the handshake has to go through the request queue.
 */
async function makeMutual(port, A, B) {
  await http(port, 'POST', `/contacts/request/${B.id}`, { token: A.token });
  const { data } = await http(port, 'GET', '/contacts/requests', { token: B.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(A.id));
  if (!req) throw new Error('no contact request landed for the accepting side');
  const acc = await http(port, 'PATCH', `/contacts/request/${req._id}`, {
    token: B.token,
    body: { action: 'accept' },
  });
  if (acc.status !== 200) throw new Error(`accept failed (${acc.status}): ${acc.data?.message}`);
}

(async () => {
  if (TEST_URI.includes('+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      /* noop */
    }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();

  /* ══ Scenario 1 — ONE instance, the exact reported path ══════════════ */
  await startServer(PORT_A);
  section('Scenario 1 — single instance, the exact reported path');

  const A = await signup(PORT_A, 'alpha');
  const B = await signup(PORT_A, 'bravo');
  await makeMutual(PORT_A, A, B);

  const sa = await connect(PORT_A, A.token);
  const sb = await connect(PORT_A, B.token);
  check('both sockets connect', sa.connected && sb.connected);
  // Presence is registered asynchronously after the handshake; the browser client
  // has the same gap. Without this, /calls/start can genuinely race it.
  await sleep(600);

  const started = await http(PORT_A, 'POST', '/calls/start', {
    token: A.token,
    body: { receiverId: B.id, callType: 'video' },
  });
  check('POST /calls/start returns 201', started.status === 201, `${started.status} ${started.data?.message}`);
  check(
    'the Call doc is `ringing`, NOT `missed` (the callee was seen as online)',
    started.data?.call?.status === 'ringing',
    `status=${started.data?.call?.status}  receiverOnline=${started.data?.receiverOnline}`
  );
  const callId = started.data?.call?._id;

  const offerAtB = waitFor(sb, 'call:offer');
  sa.emit('call:offer', { to: B.id, callId, offer: { type: 'offer', sdp: 'v=0 one-instance' } });
  const got = await offerAtB;
  check('B RECEIVES call:offer on one instance — the relay is not dead', !!got, 'no call:offer arrived');
  check('…and it carries the SDP unchanged', got?.offer?.sdp === 'v=0 one-instance', JSON.stringify(got?.offer));

  /* ══ Scenario 2 — the typing guard ══════════════════════════════════ */
  section('Scenario 2 — typing needs join-chat first (guard, not breakage)');

  const chatRes = await http(PORT_A, 'POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes.data?.chat?._id || chatRes.data?._id;
  check('a direct chat opens between two contacts', !!chatId, `${chatRes.status} ${chatRes.data?.message}`);

  // No join-chat yet — exactly what a harness that only connects will do.
  const typingBlind = waitFor(sb, 'typing-start', 2500);
  sa.emit('typing-start', { chatId });
  check(
    'WITHOUT join-chat, typing-start is silently dropped (expected)',
    !(await typingBlind),
    'it relayed — the inChat guard is not holding'
  );

  sa.emit('join-chat', chatId);
  sb.emit('join-chat', chatId);
  await sleep(500); // join-chat verifies membership in the DB before joining
  const typingJoined = waitFor(sb, 'typing-start');
  sa.emit('typing-start', { chatId });
  check('AFTER join-chat on both sockets, typing-start relays fine', !!(await typingJoined), 'still dropped');

  /* ══ Scenario 3 — two instances, REDIS_URL unset ════════════════════ */
  section('Scenario 3 — two instances, no Redis adapter (load-balanced deploy)');
  await startServer(PORT_B);

  const C = await signup(PORT_A, 'charlie');
  const D = await signup(PORT_A, 'delta');
  await makeMutual(PORT_A, C, D);

  const sc = await connect(PORT_A, C.token); // instance 1
  const sd = await connect(PORT_B, D.token); // instance 2
  check('C and D connect to DIFFERENT instances', sc.connected && sd.connected);

  // The one thing that DOES still work — and the reason this looks like a
  // partial outage rather than a config gap. It is emitted to the connecting
  // socket by its own process, so no cross-instance delivery is involved.
  const snap = await waitFor(sd, 'presence-snapshot', 4000);
  check('D still receives presence-snapshot (same-process, self-emitted)', !!snap);
  await sleep(600);

  const xStart = await http(PORT_A, 'POST', '/calls/start', {
    token: C.token,
    body: { receiverId: D.id, callType: 'video' },
  });
  check('POST /calls/start still returns 201', xStart.status === 201, `${xStart.status}`);
  check(
    'REPRODUCED: the Call doc comes back `missed` though D is connected',
    xStart.data?.call?.status === 'missed',
    `status=${xStart.data?.call?.status}  receiverOnline=${xStart.data?.receiverOnline}`
  );

  const xOfferAtD = waitFor(sd, 'call:offer', 5000);
  sc.emit('call:offer', { to: D.id, callId: xStart.data?.call?._id, offer: { type: 'offer', sdp: 'v=0 cross' } });
  check(
    'REPRODUCED: D never receives call:offer across instances',
    !(await xOfferAtD),
    'it arrived — cross-instance delivery worked, so this is NOT the cause'
  );

  [sa, sb, sc, sd].forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(60)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

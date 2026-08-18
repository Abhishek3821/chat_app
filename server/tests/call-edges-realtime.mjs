/**
 * The four call signals that only fire on an EDGE — nobody answers, the callee
 * is offline, or the callee has two tabs open.
 *
 * These were the last unproven paths in the call layer. Each one is invisible in
 * a happy-path test because it only exists to close a UI that would otherwise
 * hang: a ringing screen on a second device after you answered on the first, a
 * dial tone to someone who isn't connected, a caller who gave up.
 *
 * Also pins the DASH ALIASES (`reject-call`, `call-missed`). Every call signal
 * ships under two names so a third-party client can use either convention, and
 * an alias that silently stopped being emitted would break those integrations
 * while the web app — which listens on `call:*` — stayed perfectly fine.
 *
 * Run:  node tests/call-edges-realtime.mjs   (from /server)
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

const PORT = 5127;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_calledge$2');
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
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

let serverProc = null;
async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), MONGO_URI: TEST_URI, NODE_ENV: 'development', ENABLE_EMAIL_VERIFICATION: 'false', CLIENT_URL: 'http://localhost:5290' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 200)); });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

const sockets = [];
async function finish(code) {
  sockets.forEach((s) => s.close());
  try { await mongoose.disconnect(); } catch { /* noop */ }
  serverProc?.kill();
  await sleep(200);
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

/** First payload of `event`, or null after `ms` — a missing emit fails, not hangs. */
function waitFor(socket, event, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(null); }, ms);
    function onEvent(payload) { clearTimeout(timer); socket.off(event, onEvent); resolve(payload ?? {}); }
    socket.on(event, onEvent);
  });
}

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_700_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: { name: `${tag.toUpperCase()} Tester`, username: `${tag}${stamp}`, email: `${tag}${stamp}@test.local`, password, confirmPassword: password, phone },
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
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const A = await makeUser('callera');
  const B = await makeUser('calleeb');
  await befriend(A, B);
  const { data: chatRes } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes?.chat?._id;

  const sa = await connect(A.token);
  await sleep(300);

  /* ── Callee not connected ───────────────────────────────────────── */
  section('Inviting someone who is not connected');
  const unavailable = waitFor(sa, 'call:unavailable');
  sa.emit('call:invite', { to: B.id, callId: new mongoose.Types.ObjectId().toString(), type: 'audio', chatId });
  const un = await unavailable;
  check('the caller is told immediately', !!un, 'no call:unavailable within 4s');
  check('and it names who could not be reached', String(un?.to) === String(B.id), JSON.stringify(un));

  /* ── Answering on one device closes the ring on the others ──────── */
  section('Callee has two tabs open and answers on one');
  const sb1 = await connect(B.token);
  const sb2 = await connect(B.token);
  await sleep(400);

  const callId = new mongoose.Types.ObjectId().toString();
  const bothRing = Promise.all([waitFor(sb1, 'call:incoming'), waitFor(sb2, 'call:incoming')]);
  sa.emit('call:invite', { to: B.id, callId, type: 'audio', chatId, caller: { _id: A.id, name: A.name } });
  const [ring1, ring2] = await bothRing;
  check('every device of the callee rings', !!ring1 && !!ring2);

  // Tab 2 must be told to stop ringing when tab 1 answers.
  const handled = waitFor(sb2, 'call:handled');
  const accepted = waitFor(sa, 'call:accepted');
  sb1.emit('call:accept', { to: A.id, callId, chatId });
  check('the caller sees the answer', !!(await accepted));
  const h = await handled;
  check("the callee's OTHER tab is told it was handled", !!h, 'no call:handled within 4s');
  check('and it says which call', String(h?.callId) === String(callId), JSON.stringify(h));

  /* ── Rejection, and its dash alias ──────────────────────────────── */
  section('Rejection reaches the caller under BOTH event names');
  const callId2 = new mongoose.Types.ObjectId().toString();
  await waitFor(sb1, 'call:incoming', 1000).catch(() => null);
  const rejected = waitFor(sa, 'call:rejected');
  const rejectedAlias = waitFor(sa, 'reject-call');
  sa.emit('call:invite', { to: B.id, callId: callId2, type: 'audio', chatId });
  await sleep(250);
  sb1.emit('call:reject', { to: A.id, callId: callId2, chatId });
  check('call:rejected — the namespaced name the web app uses', !!(await rejected));
  check('reject-call — the dash alias a third-party client may use', !!(await rejectedAlias), 'alias not emitted');

  /* ── Caller's connection dies while it is still ringing ─────────── */
  section("Caller's browser dies before anyone answers");
  /* This is where call:cancelled / call-missed actually come from — the
     DISCONNECT handler, not `call:end` (which always sends call:ended).
     It needs a real Call record too: the ringing→ended transition is what
     `transitionCall` maps to 'missed', and that is what picks the cancelled
     event names over the ended ones. A socket-invented callId has no row, so
     the branch would silently pick 'ended'. */
  /* `receiverId` + `callType` — the REST field names. The SOCKET signals use
     `to` and `type`; mixing the two up is the documented trap in
     SOCKET_EVENTS.md §2, and it fails silently on the socket side. */
  const started = await http('POST', '/calls/start', {
    token: A.token,
    body: { receiverId: B.id, callType: 'audio' },
  });
  const callId3 = started.data?.call?._id;
  check('the call record exists before ringing', started.status === 201 && !!callId3, `${started.status} ${started.data?.message}`);

  const cancelled = waitFor(sb1, 'call:cancelled');
  const cancelledAlias = waitFor(sb1, 'call-missed');
  const sa2 = await connect(A.token); // a second caller socket, safe to kill
  await sleep(200);
  sa2.emit('call:invite', { to: B.id, callId: callId3, type: 'audio', chatId });
  await sleep(400);
  sa2.close(); // the caller vanishes mid-ring
  check('call:cancelled closes the ringing screen', !!(await cancelled), 'no call:cancelled within 4s');
  check('call-missed — the dash alias for the same thing', !!(await cancelledAlias), 'alias not emitted');

  await sleep(400);
  const history = await http('GET', '/calls', { token: A.token });
  check(
    'and the unanswered call is recorded as missed, not completed',
    (history.data?.calls || []).some((c) => String(c._id) === String(callId3) && c.status === 'missed'),
    JSON.stringify((history.data?.calls || []).map((c) => `${String(c._id).slice(-4)}:${c.status}`))
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

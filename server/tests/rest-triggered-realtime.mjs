/**
 * The realtime events that a REST call sets off — the last unproven paths.
 *
 * These are easy to miss precisely because the REST side always looks fine: the
 * endpoint returns 200, the database is right, and the only thing broken is that
 * the other person's screen doesn't move until they reload. Every check below
 * therefore asserts on what the OTHER socket receives, never on the response.
 *
 *   live-location / live-location-stopped   sharing your position, and stopping
 *   chat-updated                            the sidebar nudge for a new chat row
 *   contact-removed                         unfriending, which is mutual
 *   scheduled-message                       schedule + cancel, to your own devices
 *
 * Run:  node tests/rest-triggered-realtime.mjs   (from /server)
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

const PORT = 5133;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env — cannot run.'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_restrt$2');
if (TEST_URI === baseUri) { console.error('Refusing to run: could not derive an isolated test database name.'); process.exit(1); }

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

/** Match on the expected STATE, not just "the next event" — see the note in
 *  meeting-collab-realtime.mjs for why order-based waiting is a trap here. */
function waitFor(socket, event, { match = () => true, ms = 8000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(null); }, ms);
    function onEvent(payload) {
      let ok = false;
      try { ok = !!match(payload); } catch { ok = false; }
      if (!ok) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload ?? {});
    }
    socket.on(event, onEvent);
  });
}

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(9_000_000 + phoneSeq++).slice(0, 7)}`;
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

  const A = await makeUser('rta');
  const B = await makeUser('rtb');
  await befriend(A, B);
  const { data: chatRes } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes?.chat?._id;

  const sa = await connect(A.token);
  const sb = await connect(B.token);
  await sleep(300);

  /* ── Live location ──────────────────────────────────────────────── */
  section('Sharing a live location');
  /* `live-location` goes to the CHAT room, which is opt-in: a socket is only in
     it after `join-chat`. Without this the updates are emitted to an empty room
     and look like a dead feature. */
  sa.emit('join-chat', chatId);
  sb.emit('join-chat', chatId);
  await sleep(400);

  const chatNudge = waitFor(sb, 'chat-updated', { match: (p) => String(p?.chatId) === String(chatId) });
  const started = await http('POST', '/live-location/start', {
    token: A.token,
    body: { chatId, lat: 51.5074, lng: -0.1278, durationSecs: 300 },
  });
  const messageId = started.data?.message?._id;
  check('the share starts', started.status === 201 && !!messageId, `${started.status} ${started.data?.message}`);
  check("the other side's sidebar is nudged (chat-updated)", !!(await chatNudge), 'no chat-updated within 8s');

  const moved = waitFor(sb, 'live-location', { match: (p) => String(p?.messageId) === String(messageId) });
  await http('POST', `/live-location/${messageId}/update`, { token: A.token, body: { lat: 51.5085, lng: -0.1265 } });
  const move = await moved;
  check('a position update reaches the other person live', !!move, 'no live-location within 8s');
  check('carrying the new coordinates', typeof move?.lat === 'number' && typeof move?.lng === 'number', JSON.stringify(move));
  check('and the chat + message it belongs to', String(move?.chatId) === String(chatId));

  const stopped = waitFor(sb, 'live-location-stopped', { match: (p) => String(p?.messageId) === String(messageId) });
  const stopRes = await http('POST', `/live-location/${messageId}/stop`, { token: A.token });
  check('stopping succeeds', stopRes.status === 200, `${stopRes.status}`);
  check('and the live badge is turned off on the other side', !!(await stopped), 'no live-location-stopped within 8s');

  /* ── Scheduled messages ─────────────────────────────────────────── */
  section('Scheduling a message tells your own other devices');
  const sa2 = await connect(A.token); // a second device for the same person
  await sleep(300);

  const scheduledSeen = waitFor(sa2, 'scheduled-message', { match: (p) => p?.status === 'pending' });
  const sched = await http('POST', '/messages/schedule', {
    token: A.token,
    body: { chatId, content: 'later', sendAt: new Date(Date.now() + 60_000).toISOString() },
  });
  check('the message is scheduled', sched.status === 201, `${sched.status} ${sched.data?.message}`);
  const pending = await scheduledSeen;
  check("the author's other device is told", !!pending, 'no scheduled-message within 8s');
  check('with the chat and a pending status', String(pending?.chatId) === String(chatId) && pending?.status === 'pending', JSON.stringify(pending));

  const scheduledId = sched.data?.scheduled?._id || pending?.id;
  const cancelSeen = waitFor(sa2, 'scheduled-message', { match: (p) => p?.status === 'cancelled' });
  const cancelled = await http('DELETE', `/messages/scheduled/${scheduledId}`, { token: A.token });
  check('it can be cancelled', cancelled.status === 200, `${cancelled.status} ${cancelled.data?.message}`);
  check('and the other device is told it was cancelled', !!(await cancelSeen), 'no cancelled status within 8s');

  const otherPersonSees = waitFor(sb, 'scheduled-message', { ms: 2000 });
  check('the RECIPIENT never sees your scheduled-message events', (await otherPersonSees) === null);

  /* ── Unfriending ────────────────────────────────────────────────── */
  section('Unfriending is mutual, and both sides are told live');
  const theyAreTold = waitFor(sb, 'contact-removed', { match: (p) => String(p?.userId) === String(A.id) });
  const myOtherTab = waitFor(sa2, 'contact-removed', { match: (p) => String(p?.userId) === String(B.id) });
  const removed = await http('DELETE', `/users/me/contacts/${B.id}`, { token: A.token });
  check('the unfriend succeeds', removed.status === 200, `${removed.status} ${removed.data?.message}`);

  const told = await theyAreTold;
  check('the person removed is told live', !!told, 'no contact-removed within 8s');
  check('and told who did it', !!told?.by, JSON.stringify(told));
  check("the actor's OWN other tab drops the row too", !!(await myOtherTab), 'no echo to the actor');

  const aList = (await http('GET', '/users/me/contacts', { token: A.token })).data?.contacts || [];
  const bList = (await http('GET', '/users/me/contacts', { token: B.token })).data?.contacts || [];
  check('both contact lists agree afterwards', !aList.some((c) => String(c._id) === String(B.id)) && !bList.some((c) => String(c._id) === String(A.id)));

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

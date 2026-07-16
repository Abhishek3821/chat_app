/**
 * ChatConnect end-to-end test suite.
 *
 * Boots the real server against an ISOLATED test database (chatconnect_e2e),
 * then drives two real users (A, B) + one seeded admin through:
 *   auth (signup/login/JWT/role security), admin authorization, contacts,
 *   real-time chat both directions, typing, presence, and the full WebRTC
 *   signaling flow (call → accept → offer/answer/ICE → end, reject, cancel,
 *   offline-missed) in BOTH directions — using the spec'd dash-form event
 *   names to prove the aliases too.
 *
 * Run:  node tests/e2e.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5101;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run E2E tests.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_e2e$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

// ── tiny test harness ─────────────────────────────────────────────
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, { token, body } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

function waitFor(socket, event, { timeout = 5000, filter } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
    }, timeout);
    function handler(payload) {
      if (filter && !filter(payload)) return; // keep listening
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 6000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// ── boot ──────────────────────────────────────────────────────────
let serverProc = null;
let sockA = null;
let sockB = null;
let sockAdmin = null;

async function startServer() {
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
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 300));
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

async function cleanupAndExit(code) {
  for (const s of [sockA, sockB, sockAdmin]) {
    try {
      s?.disconnect();
    } catch {
      /* noop */
    }
  }
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  if (serverProc && !serverProc.killed) serverProc.kill();
  await sleep(300);
  process.exit(code);
}

// ── the suite ─────────────────────────────────────────────────────
async function main() {
  console.log('\nChatConnect E2E — isolated DB:', TEST_URI.replace(/\/\/[^@]*@/, '//***@'), '\n');

  // Fresh database + out-of-band admin (simulates the seed script path).
  if (TEST_URI.includes('+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      /* noop */
    }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  const { default: User } = await import('../models/User.js');
  const ADMIN = { email: 'admin.e2e@chatconnect.app', password: 'AdminPass123!' };
  await User.create({
    name: 'E2E Admin',
    username: 'admin_e2e',
    email: ADMIN.email,
    password: ADMIN.password,
    role: 'admin', // created directly in the DB — the ONLY sanctioned way
    isVerified: true,
  });

  await startServer();
  console.log('Server is up. Running tests…\n');

  const A = { name: 'User A', email: 'a.e2e@chatconnect.app', password: 'PasswordA1!' };
  const B = { name: 'User B', email: 'b.e2e@chatconnect.app', password: 'PasswordB1!' };

  // ── 1. Signup & role security ──────────────────────────────────
  console.log('— Auth & role security');
  {
    const r = await http('POST', '/auth/signup', {
      body: { ...A, confirmPassword: A.password, role: 'admin', isAdmin: true, admin: true },
    });
    check('signup A succeeds', r.status === 201, `status ${r.status}: ${r.data?.message}`);
    check('signup A: injected role/isAdmin ignored → role is "user"', r.data?.user?.role === 'user', `role=${r.data?.user?.role}`);
    check('signup A: response has no password field', r.data?.user && !('password' in r.data.user));
    check('signup A: username auto-generated', typeof r.data?.user?.username === 'string' && r.data.user.username.length >= 3, `username=${r.data?.user?.username}`);
    A.token = r.data?.token;
    A.id = r.data?.user?._id;
  }
  {
    const r = await http('POST', '/auth/signup', { body: { ...B, confirmPassword: B.password } });
    check('signup B succeeds with role "user"', r.status === 201 && r.data?.user?.role === 'user');
    B.token = r.data?.token;
    B.id = r.data?.user?._id;
  }
  {
    const r = await http('POST', '/auth/signup', { body: { ...A, confirmPassword: A.password } });
    check('duplicate email signup blocked (409)', r.status === 409, `status ${r.status}`);
  }
  {
    const r = await http('POST', '/auth/signup', {
      body: { name: 'Shorty', email: 'short.e2e@chatconnect.app', password: 'short', confirmPassword: 'short' },
    });
    check('short password rejected (400)', r.status === 400, `status ${r.status}`);
  }
  {
    const r = await http('POST', '/auth/signup', { body: { email: 'x.e2e@chatconnect.app' } });
    check('missing fields rejected (400)', r.status === 400);
  }
  {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const r = await http('POST', '/auth/signup', {
      body: { name: 'Ava Photo', email: 'c.e2e@chatconnect.app', password: 'PasswordC1!', confirmPassword: 'PasswordC1!', avatar: png },
    });
    check('signup with optional profile photo stores it', r.status === 201 && r.data?.user?.avatar?.startsWith('data:image/'), `avatar=${String(r.data?.user?.avatar).slice(0, 24)}…`);
  }

  // ── 2. Login verification ──────────────────────────────────────
  {
    const r = await http('POST', '/auth/login', { body: { email: A.email, password: 'WrongPass1!' } });
    check('login with wrong password fails (401)', r.status === 401);
  }
  {
    const r = await http('POST', '/auth/login', { body: { email: 'nobody.e2e@chatconnect.app', password: A.password } });
    check('login with wrong email fails (401)', r.status === 401);
  }
  {
    const r = await http('POST', '/auth/login', { body: { email: A.email, password: A.password } });
    check('login A with correct password succeeds', r.status === 200 && !!r.data?.token);
    check('login response has no password field', r.data?.user && !('password' in r.data.user));
    A.token = r.data?.token || A.token;
    const payload = decodeJwtPayload(A.token);
    const claimKeys = Object.keys(payload).filter((k) => !['iat', 'exp'].includes(k)).sort();
    check(
      'access JWT carries only { id, role, tokenVersion, sid, type }',
      payload.id === A.id &&
        payload.role === 'user' &&
        payload.type === 'access' &&
        typeof payload.sid === 'string' &&
        claimKeys.every((k) => ['id', 'role', 'tokenVersion', 'sid', 'type'].includes(k)),
      `claims: ${claimKeys.join(',')}`
    );
  }
  {
    const r = await http('GET', '/auth/me', { token: A.token });
    check('GET /auth/me with valid token works (session survives refresh)', r.status === 200 && r.data?.user?._id === A.id);
  }
  {
    const r = await http('GET', '/auth/me');
    check('protected route without token → 401', r.status === 401);
    const r2 = await http('GET', '/auth/me', { token: 'garbage.token.here' });
    check('protected route with invalid token → 401', r2.status === 401);
  }

  // ── 3. Admin authorization ─────────────────────────────────────
  console.log('— Admin protection');
  {
    const r = await http('POST', '/auth/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    check('seeded admin can log in (role=admin)', r.status === 200 && r.data?.user?.role === 'admin');
    ADMIN.token = r.data?.token;
  }
  {
    const r = await http('GET', '/admin/stats', { token: ADMIN.token });
    check('admin can access /admin/stats', r.status === 200 && r.data?.stats);
  }
  {
    const r = await http('GET', '/admin/stats', { token: A.token });
    check('normal user gets 403 on admin routes', r.status === 403, `status ${r.status}`);
    const r2 = await http('GET', '/admin/users', { token: B.token });
    check('normal user gets 403 on /admin/users', r2.status === 403);
    const r3 = await http('GET', '/admin/stats');
    check('anonymous gets 401 on admin routes', r3.status === 401);
  }
  {
    const r = await http('GET', '/calls/history');
    check('call APIs require auth (401 without token)', r.status === 401);
  }

  // ── 4. Contacts + chat setup ───────────────────────────────────
  console.log('— Contacts & chat');
  let chatId = null;
  {
    const r = await http('POST', `/contacts/request/${B.id}`, { token: A.token });
    check('A sends contact request to B', r.status === 201 || r.status === 200);
    const list = await http('GET', '/contacts/requests', { token: B.token });
    const reqId = list.data?.incoming?.[0]?._id;
    const acc = await http('PATCH', `/contacts/request/${reqId}`, { token: B.token, body: { action: 'accept' } });
    check('B accepts → mutual contacts', acc.status === 200);
    const chat = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
    chatId = chat.data?.chat?._id;
    check('1:1 chat created', !!chatId);
  }

  // ── 5. Realtime: presence, chat, typing ────────────────────────
  console.log('— Realtime messaging');
  {
    let rejected = false;
    try {
      await connectSocket('not-a-real-token');
    } catch {
      rejected = true;
    }
    check('socket connection without valid JWT is rejected', rejected);
  }
  sockA = await connectSocket(A.token);
  const bOnlineSeen = waitFor(sockA, 'user-online', { filter: (p) => String(p.userId) === String(B.id), timeout: 6000 });
  sockB = await connectSocket(B.token);
  check('A notified that B came online', await bOnlineSeen.then(() => true).catch(() => false));

  {
    const ack = await new Promise((res) => {
      sockB.emit('register-user', (a) => res(a));
      setTimeout(() => res(null), 3000);
    });
    check('register-user acks with userId', ack?.ok === true && String(ack.userId) === String(B.id));
  }

  sockA.emit('join-chat', chatId);
  sockB.emit('join-chat', chatId);
  await sleep(500); // membership check is async server-side

  {
    const gotAtB = waitFor(sockB, 'receive-message', { filter: (p) => p.message?.content === 'hello B — from A' });
    const sent = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'hello B — from A' } });
    check('A sends message via API', sent.status === 201);
    check('B receives A’s message in real time', await gotAtB.then(() => true).catch(() => false));
  }
  {
    const gotAtA = waitFor(sockA, 'receive-message', { filter: (p) => p.message?.content === 'hi A — from B' });
    const sent = await http('POST', '/messages', { token: B.token, body: { chatId, content: 'hi A — from B' } });
    check('B sends message via API', sent.status === 201);
    check('A receives B’s message in real time', await gotAtA.then(() => true).catch(() => false));
  }
  {
    const typingAtB = waitFor(sockB, 'typing-start', { filter: (p) => p.chatId === chatId });
    sockA.emit('typing-start', { chatId });
    check('typing indicator A → B', await typingAtB.then(() => true).catch(() => false));
    const typingAtA = waitFor(sockA, 'typing-start', { filter: (p) => p.chatId === chatId });
    sockB.emit('typing-start', { chatId });
    check('typing indicator B → A', await typingAtA.then(() => true).catch(() => false));
  }

  // ── 6. Calls: A → B full flow (spec alias event names) ─────────
  console.log('— Calling: A → B (audio, completed)');
  {
    const started = await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'audio' } });
    const callId = String(started.data?.call?._id || '');
    check('POST /calls/start creates record + reports receiver online', started.status === 201 && started.data?.receiverOnline === true && !!callId);

    const incoming = waitFor(sockB, 'incoming-call', { filter: (p) => p.callId === callId });
    sockA.emit('call-user', { to: B.id, callId, type: 'audio', caller: { _id: A.id, name: A.name } });
    const inc = await incoming.then((p) => p).catch(() => null);
    check('B receives incoming-call with caller info', !!inc && String(inc.from) === String(A.id));

    const acceptedAtA = waitFor(sockA, 'accept-call', { filter: (p) => p.callId === callId });
    sockB.emit('accept-call', { to: A.id, callId });
    check('A receives accept-call', await acceptedAtA.then(() => true).catch(() => false));

    const offerAtB = waitFor(sockB, 'webrtc-offer', { filter: (p) => p.callId === callId });
    sockA.emit('webrtc-offer', { to: B.id, callId, offer: { type: 'offer', sdp: 'x-fake-sdp' } });
    const off = await offerAtB.then((p) => p).catch(() => null);
    check('B receives webrtc-offer', off?.offer?.sdp === 'x-fake-sdp');

    const answerAtA = waitFor(sockA, 'webrtc-answer', { filter: (p) => p.callId === callId });
    sockB.emit('webrtc-answer', { to: A.id, callId, answer: { type: 'answer', sdp: 'x-fake-answer' } });
    check('A receives webrtc-answer', await answerAtA.then((p) => p.answer?.sdp === 'x-fake-answer').catch(() => false));

    const iceAtB = waitFor(sockB, 'webrtc-ice-candidate', { filter: (p) => p.callId === callId });
    sockA.emit('webrtc-ice-candidate', { to: B.id, callId, candidate: { candidate: 'cand:1' } });
    check('ICE candidates relayed A → B', await iceAtB.then(() => true).catch(() => false));
    const iceAtA = waitFor(sockA, 'webrtc-ice-candidate', { filter: (p) => p.callId === callId });
    sockB.emit('webrtc-ice-candidate', { to: A.id, callId, candidate: { candidate: 'cand:2' } });
    check('ICE candidates relayed B → A', await iceAtA.then(() => true).catch(() => false));

    const endedAtB = waitFor(sockB, 'call-ended', { filter: (p) => p.callId === callId });
    sockA.emit('end-call', { to: B.id, callId, duration: 12 });
    check('B receives call-ended when A hangs up', await endedAtB.then(() => true).catch(() => false));

    await sleep(400);
    const hist = await http('GET', '/calls/history', { token: A.token });
    const rec = (hist.data?.calls || []).find((c) => String(c._id) === callId);
    check('history: call saved as completed with duration', rec?.status === 'completed' && rec?.duration === 12, `status=${rec?.status} duration=${rec?.duration}`);
    check('history: direction outgoing for A, peer is B', rec?.direction === 'outgoing' && String(rec?.peer?._id) === String(B.id));
    const histB = await http('GET', '/calls/history', { token: B.token });
    const recB = (histB.data?.calls || []).find((c) => String(c._id) === callId);
    check('history: direction incoming for B', recB?.direction === 'incoming');
  }

  // ── 7. Calls: B → A (video, rejected) ──────────────────────────
  console.log('— Calling: B → A (video, rejected)');
  {
    const started = await http('POST', '/calls/start', { token: B.token, body: { receiverId: A.id, callType: 'video' } });
    const callId = String(started.data?.call?._id || '');
    check('B can start a video call to A (reverse direction)', started.status === 201 && started.data?.call?.type === 'video');

    const incoming = waitFor(sockA, 'call:incoming', { filter: (p) => p.callId === callId });
    sockB.emit('call:invite', { to: A.id, callId, type: 'video' });
    check('A receives call:incoming (video)', await incoming.then((p) => p.type === 'video').catch(() => false));

    const rejectedAtB = waitFor(sockB, 'call:rejected', { filter: (p) => p.callId === callId });
    sockA.emit('call:reject', { to: B.id, callId });
    check('B sees call rejected', await rejectedAtB.then(() => true).catch(() => false));

    await sleep(400);
    const hist = await http('GET', '/calls/history', { token: B.token });
    const rec = (hist.data?.calls || []).find((c) => String(c._id) === callId);
    check('history: call saved as rejected', rec?.status === 'rejected', `status=${rec?.status}`);
  }

  // ── 8. Calls: cancel → missed ──────────────────────────────────
  console.log('— Calling: A → B (cancelled → missed)');
  {
    const started = await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'audio' } });
    const callId = String(started.data?.call?._id || '');
    const incoming = waitFor(sockB, 'call:incoming', { filter: (p) => p.callId === callId });
    sockA.emit('call:invite', { to: B.id, callId, type: 'audio' });
    await incoming.catch(() => null);

    const cancelledAtB = waitFor(sockB, 'call:cancelled', { filter: (p) => p.callId === callId });
    sockA.emit('call:cancel', { to: B.id, callId });
    check('B notified the caller cancelled (missed)', await cancelledAtB.then(() => true).catch(() => false));

    await sleep(400);
    const hist = await http('GET', '/calls/history', { token: B.token });
    const rec = (hist.data?.calls || []).find((c) => String(c._id) === callId);
    check('history: cancelled ring saved as missed', rec?.status === 'missed', `status=${rec?.status}`);
  }

  // ── 9. Offline receiver ────────────────────────────────────────
  console.log('— Calling: offline receiver');
  {
    const bOffline = waitFor(sockA, 'user-offline', { filter: (p) => String(p.userId) === String(B.id), timeout: 8000 });
    sockB.disconnect();
    await bOffline.catch(() => null);

    const started = await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'audio' } });
    check('start call to OFFLINE user reports receiverOnline=false', started.status === 201 && started.data?.receiverOnline === false);
    check('offline call is immediately logged as missed', started.data?.call?.status === 'missed', `status=${started.data?.call?.status}`);
  }

  // ── summary ────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${'─'.repeat(50)}\n${passed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ''}\n`);
  if (failed) {
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`));
    console.log();
  }
  await cleanupAndExit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nE2E suite crashed:', err);
  await cleanupAndExit(1);
});

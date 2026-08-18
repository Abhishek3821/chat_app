/**
 * The exact embed-partner 1:1 scenario: platform-minted tokens, raw Socket.IO,
 * no groups, no Call record pre-created through any UI.
 *
 * A partner reported that `call:offer` emitted straight over the socket is never
 * relayed, while `presence-snapshot` arrives — and that `typing-start` is
 * likewise silent. Their emit payload was `{ receiverId, offer, callType }`.
 *
 * `receiverId` and `callType` are REST fields (`POST /api/calls/start`). The
 * socket handler destructures `{ to, offer, callId, chatId }` and guards on
 * `if (to && …)`, so a payload without `to` returns SILENTLY — no error, no log,
 * which is precisely "the server just doesn't forward it".
 *
 * This pins down, on the platform path specifically:
 *   · is `canCallSignal` in the relay path for a RAW socket emit? (vs. scoped to
 *     Call records created by the first-party app)
 *   · does a raw offer relay with NO callId and NO Call record at all?
 *   · is `{ receiverId }` dropped where `{ to }` is delivered?
 *   · is typing user-targetable at all, or strictly chat-room scoped?
 *
 * Run:  node tests/embed-1to1-signalling.mjs   (from /server)
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

const PORT = 5137;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_embed1to1$2');
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

async function http(method, url, { token, appId, secret, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appId) {
    headers['X-CC-App-Id'] = appId;
    if (secret) headers.Authorization = `Bearer ${secret}`;
  }
  const res = await fetch(`${API}${url}`, {
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

let serverProc = null;
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
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 240));
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

async function finish(code) {
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  serverProc?.kill();
  await sleep(200);
  process.exit(code);
}

let seq = 0;
async function makeOwner(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag} Owner`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+1555${String(9_500_000 + seq++).slice(0, 7)}`,
    },
  });
  if (status !== 201) throw new Error(`signup failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id };
}

/** Provision an end user for a tenant and mint their short-lived token. */
async function tenantUser(app, externalId, name) {
  await http('POST', '/v1/platform/users', {
    appId: app.appId,
    secret: app.secret,
    body: { externalId, name },
  });
  const { data } = await http('POST', '/v1/platform/tokens', {
    appId: app.appId,
    secret: app.secret,
    body: { externalId },
  });
  return { token: data?.token, id: data?.user?.id, name };
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    /* Armed BEFORE `connect` resolves. The server emits presence-snapshot on the
       connection itself, so a listener attached after any later `await` races it
       and reads as "never arrived" — which is a test bug, not a relay bug. */
    s.snapshot = new Promise((res) => {
      const t = setTimeout(() => res(null), 8000);
      s.once('presence-snapshot', (p) => {
        clearTimeout(t);
        res(p);
      });
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

/** NULL on timeout — a missing relay must read as failure, never as a hang. */
const waitFor = (socket, event, ms = 5000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/** Mutual contacts via the real request/accept flow — what `canSignal` needs. */
async function makeMutual(A, B) {
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  const { data } = await http('GET', '/contacts/requests', { token: B.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(A.id));
  if (!req) throw new Error('no contact request landed for the accepting side');
  const acc = await http('PATCH', `/contacts/request/${req._id}`, {
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
  await startServer();

  /* ── Set up exactly as an embed partner would ────────────────────── */
  section('Embed partner setup (App Id/Secret → provisioned users → tokens)');
  const owner = await makeOwner('embed');
  const created = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Partner Co', features: ['chat', 'calls', 'video', 'presence', 'typing'] },
  });
  check('the app is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const app = { appId: created.data?.app?.appId, secret: created.data?.secret };

  const A = await tenantUser(app, 'p-a', 'Ada');
  const B = await tenantUser(app, 'p-b', 'Bo');
  check('two users provisioned with minted tokens', !!(A.token && B.token));

  await makeMutual(A, B);
  const chatRes = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes.data?.chat?._id || chatRes.data?._id;
  check('a real direct chat is opened between them', !!chatId, `${chatRes.status} ${chatRes.data?.message}`);

  const sa = await connect(A.token);
  const sb = await connect(B.token);
  check('both sockets connect with platform tokens', sa.connected && sb.connected);
  await sleep(600);

  check('B receives presence-snapshot (the event that DID arrive)', !!(await sb.snapshot));

  /* ── The reported payload ────────────────────────────────────────── */
  section('The reported payload: { receiverId, offer, callType }');
  const dropped = waitFor(sb, 'call:offer', 3000);
  sa.emit('call:offer', {
    receiverId: B.id, // REST field name — the socket handler reads `to`
    offer: { type: 'offer', sdp: 'v=0 rest-field-name' },
    callType: 'video',
  });
  check(
    'REPRODUCED: an offer keyed `receiverId` is silently dropped',
    !(await dropped),
    'it relayed — receiverId is NOT the cause'
  );

  /* ── The documented payload, same socket, same instant ───────────── */
  section('The documented payload: { to, offer } — no callId, no Call record');
  const delivered = waitFor(sb, 'call:offer');
  sa.emit('call:offer', { to: B.id, offer: { type: 'offer', sdp: 'v=0 correct-field' } });
  const got = await delivered;
  check('the SAME socket relays fine when the field is `to`', !!got, 'still dropped');
  check('the SDP arrives unchanged', got?.offer?.sdp === 'v=0 correct-field', JSON.stringify(got?.offer));
  check('the relay stamps `from` so the peer knows who offered', String(got?.from) === String(A.id), JSON.stringify(got?.from));

  /* This is the direct answer to "is authorization scoped to Call records
     created through your own app's UI?" — there is no callId here at all. */
  check(
    'authorization needs NO callId and NO pre-existing Call record',
    !!got && got.callId === undefined,
    `callId=${JSON.stringify(got?.callId)}`
  );

  const ansAtA = waitFor(sa, 'call:answer');
  sb.emit('call:answer', { to: A.id, answer: { type: 'answer', sdp: 'v=0 ans' } });
  check('call:answer relays on the same raw path', !!(await ansAtA));

  const iceAtB = waitFor(sb, 'call:ice-candidate');
  sa.emit('call:ice-candidate', { to: B.id, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1 typ host' } });
  check('call:ice-candidate relays on the same raw path', !!(await iceAtB));

  /* ── Is the authorization actually enforced on this path? ─────────── */
  section('canCallSignal IS enforced here (not a UI-only gate)');
  const S = await tenantUser(app, 'p-s', 'Stranger');
  const ss = await connect(S.token);
  await sleep(400);
  const strangerOffer = waitFor(sb, 'call:offer', 3000);
  ss.emit('call:offer', { to: B.id, offer: { type: 'offer', sdp: 'v=0 stranger' } });
  check(
    'a NON-contact tenant user cannot offer to B — same handler, gate holds',
    !(await strangerOffer),
    'a stranger offer relayed'
  );

  /* ── Ending a call: the emit name and the LISTEN name differ ─────── */
  section('Ending a call: emit `call:end`, listen for `call:ended`');
  const realCall = await http('POST', '/calls/start', {
    token: A.token,
    body: { receiverId: B.id, callType: 'video' },
  });
  const liveCallId = realCall.data?.call?._id;
  check('a real Call record exists to end', !!liveCallId, `${realCall.status}`);

  /* The trap: the server does NOT echo the event it received. `call:end` in →
     `call:ended` + `call-ended` out. A listener bound to `call:end` hears nothing
     forever, which looks identical to a relay that never fired. */
  const echoSameName = waitFor(sb, 'call:end', 2500);
  const pastTense = waitFor(sb, 'call:ended', 4000);
  const dashAlias = waitFor(sb, 'call-ended', 4000);
  sa.emit('call:end', { to: B.id, callId: liveCallId, duration: 12 });

  check('listening for `call:end` (the name you EMIT) hears nothing', !(await echoSameName));
  const ended = await pastTense;
  check('`call:ended` IS delivered — this is the name to listen for', !!ended, 'nothing arrived');
  check('it names who hung up', String(ended?.from) === String(A.id), JSON.stringify(ended?.from));
  check('the `call-ended` dash alias fires too', !!(await dashAlias));

  const cancelled = waitFor(sb, 'call:cancelled', 4000);
  sa.emit('call:cancel', { to: B.id, callId: liveCallId });
  check('`call:cancel` likewise arrives as `call:cancelled`', !!(await cancelled));

  /* `callId` drives history only (`logCall` is best-effort); the RELAY needs
     just `to`. So a missing callId is never why an end signal goes missing. */
  const endNoId = waitFor(sb, 'call:ended', 4000);
  sa.emit('call:end', { to: B.id });
  check('an end with NO callId still relays (callId is for history only)', !!(await endNoId));

  /* ── Typing: chat-room scoped, never user-targeted ───────────────── */
  section('typing-start is chat-room scoped, not user-targeted');
  const typeByUser = waitFor(sb, 'typing-start', 2500);
  sa.emit('typing-start', { receiverId: B.id });
  check('typing keyed `receiverId` is dropped (no chatId at all)', !(await typeByUser));

  const typeNoJoin = waitFor(sb, 'typing-start', 2500);
  sa.emit('typing-start', { chatId });
  check(
    'even a correct chatId is dropped before join-chat (inChat guard)',
    !(await typeNoJoin),
    'it relayed — the membership guard is not holding'
  );

  /* The second trap, and the reason "I called join-chat on both sockets" can be
     true and typing still never relays: join-chat's argument is a RAW STRING.
     Passing `{ chatId }` makes `isId(chatId)` false, so the join is a silent
     no-op, the socket never enters `chat:<id>`, and every later typing emit is
     dropped by the inChat guard with nothing to show for it. */
  section('join-chat takes a RAW STRING — an object is a silent no-op');
  sa.emit('join-chat', { chatId }); // the wrong shape
  sb.emit('join-chat', { chatId });
  await sleep(600);
  const typeObjJoin = waitFor(sb, 'typing-start', 2500);
  sa.emit('typing-start', { chatId });
  check(
    'after join-chat with an OBJECT, typing is STILL dropped',
    !(await typeObjJoin),
    'the object form joined the room — isId is not rejecting it'
  );

  sa.emit('join-chat', chatId); // the correct shape: the bare id
  sb.emit('join-chat', chatId);
  await sleep(600); // membership is verified against the DB before the room join
  const typeOk = waitFor(sb, 'typing-start');
  sa.emit('typing-start', { chatId });
  const t = await typeOk;
  check('after join-chat with a raw STRING on both, typing-start relays', !!t, 'still dropped');
  check('the typing payload names the chat and the typer', String(t?.chatId) === String(chatId) && !!t?.userId, JSON.stringify(t));

  const stopOk = waitFor(sb, 'typing-stop');
  sa.emit('typing-stop', { chatId });
  check('typing-stop relays the same way', !!(await stopOk));

  [sa, sb, ss].forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(62)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

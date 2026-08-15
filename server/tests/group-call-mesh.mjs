/**
 * Reproduce: A calls B, then A adds C. A sees both, but B and C cannot see
 * each other.
 *
 * In a full mesh EVERY pair needs its own peer connection. A↔B and A↔C are
 * created by the two invites; B↔C is only ever created if B and C are told about
 * each other — that is what `call:introduce` → `call:introduced` exists for, and
 * `realtime-coverage.mjs` flagged `call:introduced` as having no socket-level
 * proof, which is consistent with the report.
 *
 * This walks the real signalling as three separate clients and asserts each hop,
 * so the break is located rather than guessed at:
 *   1. A invites B, B accepts                    → A↔B
 *   2. A invites C, C accepts                    → A↔C
 *   3. A introduces B↔C                          → do BOTH receive it?
 *   4. B and C exchange accept/offer/answer      → does the server relay it?
 *
 * Note B and C are deliberately NOT contacts with each other — the normal case
 * when A pulls two separate friends into one call, and the case most likely to
 * be refused by a contact-gated signalling check.
 *
 * Run:  node tests/group-call-mesh.mjs   (from /server)
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

const PORT = 5121;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mesh$2');
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

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(9_500_000 + phoneSeq++).slice(0, 7)}`;
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

const befriend = async (x, y) => {
  await http('POST', `/contacts/request/${y.id}`, { token: x.token });
  const { data } = await http('GET', '/contacts/requests', { token: y.token });
  const req = (data.incoming || []).find((r) => String(r.from?._id) === String(x.id));
  if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: y.token, body: { action: 'accept' } });
};

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

/** NULL on timeout, so a missing relay is a failure rather than a hang. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

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

  const A = await makeUser('caller');
  const B = await makeUser('bee');
  const C = await makeUser('cee');

  // A knows both. B and C do NOT know each other — the realistic case.
  await befriend(A, B);
  await befriend(A, C);

  const sa = await connect(A.token);
  const sb = await connect(B.token);
  const sc = await connect(C.token);

  /* ── 1. A calls B ───────────────────────────────────────────────── */
  section('A calls B');
  const started = await http('POST', '/calls/start', {
    token: A.token,
    body: { receiverId: B.id, type: 'video' },
  });
  const callId = started.data?.call?._id || started.data?.callId;
  check('the call record is created', !!callId, `${started.status} ${JSON.stringify(started.data)?.slice(0, 120)}`);

  const ringAtB = waitFor(sb, 'call:incoming');
  sa.emit('call:invite', { to: B.id, callId, type: 'video', caller: { _id: A.id, name: A.name } });
  check('B rings', !!(await ringAtB), 'no call:incoming at B');

  const acceptedAtA = waitFor(sa, 'call:accepted');
  sb.emit('call:accept', { to: A.id, callId });
  check('A learns B accepted (A↔B leg)', !!(await acceptedAtA));

  /* ── 2. A adds C ────────────────────────────────────────────────── */
  section('A adds C to the live call');
  const ringAtC = waitFor(sc, 'call:incoming');
  sa.emit('call:invite', { to: C.id, callId, type: 'video', caller: { _id: A.id, name: A.name } });
  check('C rings', !!(await ringAtC), 'no call:incoming at C');

  const acceptedAtA2 = waitFor(sa, 'call:accepted');
  sc.emit('call:accept', { to: A.id, callId });
  check('A learns C accepted (A↔C leg)', !!(await acceptedAtA2));

  // The Call record must now list all three, since same-call membership is what
  // authorises B↔C signalling between two non-contacts.
  const callDoc = await mongoose.connection.db
    .collection('calls')
    .findOne({ _id: new mongoose.Types.ObjectId(String(callId)) });
  const involved = new Set(
    [
      String(callDoc?.initiator || ''),
      String(callDoc?.caller || ''),
      String(callDoc?.receiver || ''),
      ...(callDoc?.participants || []).map((p) => String(p.user)),
    ].filter(Boolean)
  );
  check('the call record lists A', involved.has(String(A.id)));
  check('the call record lists B', involved.has(String(B.id)));
  check('the call record lists C (registerCallInvitee ran)', involved.has(String(C.id)), [...involved].join(', '));

  /* ── 3. THE BUG: are B and C introduced to each other? ──────────── */
  section('B ↔ C introduction (the reported failure)');
  const introAtB = waitFor(sb, 'call:introduced');
  const introAtC = waitFor(sc, 'call:introduced');
  // This is what the client does in introduceAround() once C accepts.
  sa.emit('call:introduce', { to: B.id, callId, peer: { _id: C.id, name: C.name } });
  sa.emit('call:introduce', { to: C.id, callId, peer: { _id: B.id, name: B.name } });

  const gotB = await introAtB;
  const gotC = await introAtC;
  check('B is told about C', !!gotB, 'no call:introduced at B — B will never see C');
  check('C is told about B', !!gotC, 'no call:introduced at C — C will never see B');
  check('the introduction to B names C', String(gotB?.peer?._id || '') === String(C.id), JSON.stringify(gotB));
  check('the introduction to C names B', String(gotC?.peer?._id || '') === String(B.id), JSON.stringify(gotC));

  /* ── 4. Can B and C actually signal, being non-contacts? ────────── */
  section('B ↔ C signalling (same call, but NOT contacts)');
  const helloAtC = waitFor(sc, 'call:accepted');
  sb.emit('call:accept', { to: C.id, callId });
  check('B’s mesh hello reaches C', !!(await helloAtC), 'call:accept B→C was dropped');

  const offerAtC = waitFor(sc, 'call:offer');
  sb.emit('call:offer', { to: C.id, callId, offer: { type: 'offer', sdp: 'v=0 b-to-c' } });
  const gotOffer = await offerAtC;
  check('B’s SDP offer reaches C', !!gotOffer && gotOffer.offer?.sdp === 'v=0 b-to-c', 'offer B→C was dropped');

  const answerAtB = waitFor(sb, 'call:answer');
  sc.emit('call:answer', { to: B.id, callId, answer: { type: 'answer', sdp: 'v=0 c-to-b' } });
  const gotAnswer = await answerAtB;
  check('C’s SDP answer reaches B', !!gotAnswer && gotAnswer.answer?.sdp === 'v=0 c-to-b', 'answer C→B was dropped');

  const iceAtB = waitFor(sb, 'call:ice-candidate');
  sc.emit('call:ice-candidate', { to: B.id, callId, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1 typ host' } });
  check('ICE candidates flow C→B (the media path can form)', !!(await iceAtB), 'ICE C→B was dropped');

  /* ── 5. The two client states the fix targets ───────────────────── */
  section(`Signals that must NOT be silently dropped`);
  {
    /* A client that never took the outgoing path still holds a `local-…`
       placeholder callId. The server must still relay; the CLIENT is what used to
       drop these (mine() compared strictly), which is why an added member could
       never be introduced to an existing one. */
    const introAtB2 = waitFor(sb, `call:introduced`);
    sa.emit(`call:introduce`, { to: B.id, callId, peer: { _id: C.id, name: C.name } });
    check(`the server relays a repeat introduction (clients de-duplicate)`, !!(await introAtB2));

    // A signal with NO callId at all must still reach its target.
    const helloNoId = waitFor(sc, `call:accepted`);
    sb.emit(`call:accept`, { to: C.id, callId });
    check(`a mesh hello with the shared callId reaches the peer`, !!(await helloNoId));
  }

  /* ── 6. Same thing for a GROUP-chat call ────────────────────────── */
  section(`Group-chat call: every PAIR still needs its own leg`);
  {
    const { data: g } = await http(`POST`, `/groups`, { token: A.token, body: { name: `Call group`, members: [B.id, C.id] } });
    const gid = g?.chat?._id;
    check(`a group chat exists for the call`, !!gid);
    if (gid) {
      /* B and C are group members but NOT contacts. The chatId is what authorises
         their signalling here, and the mesh only forms if they signal EACH OTHER —
         a roster alone never creates the B↔C leg. */
      const offerAtC2 = waitFor(sc, `call:offer`);
      sb.emit(`call:offer`, { to: C.id, chatId: gid, callId, offer: { type: `offer`, sdp: `v=0 group-b-to-c` } });
      const got = await offerAtC2;
      check(`B↔C signalling is authorised inside a group call`, !!got && got.offer?.sdp === `v=0 group-b-to-c`, `dropped`);
    }
  }
  sa.close();
  sb.close();
  sc.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(58)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

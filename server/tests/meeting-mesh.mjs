/**
 * The meeting-room equivalent of the group-call mesh bug.
 *
 * In a call, A↔B and A↔C were created by the invites while B↔C existed only if
 * someone explicitly INTRODUCED them — which is where it broke. Meetings bootstrap
 * differently: the ROOM is the source of truth, the join acknowledgement hands the
 * newcomer the existing peer list, and `meeting:signal` is authorised by room
 * membership rather than by contacts. That SHOULD make it immune to the same
 * failure, but "should" is not evidence, so this proves it with three and then
 * four participants:
 *
 *   · does the 3rd joiner's ack list BOTH people already in the room (not just one)?
 *   · do BOTH of them get told about the newcomer?
 *   · can the pair who never invited each other signal directly?
 *   · does a 4th joiner see all three, and all three see them?
 *   · when one leaves, does everyone learn — including the person they never
 *     directly interacted with?
 *
 * B, C and D are deliberately NOT contacts with each other, and only the host
 * invited them, so nothing but room membership can be authorising the mesh.
 *
 * Run:  node tests/meeting-mesh.mjs   (from /server)
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

const PORT = 5123;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mtgmesh$2');
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
  const phone = `+1555${String(9_700_000 + phoneSeq++).slice(0, 7)}`;
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

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

/** NULL on timeout, so a missing relay fails rather than hangs. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

const joinMeeting = (socket, meetingId, ms = 8000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), ms);
    socket.emit('meeting:join', { meetingId }, (ack) => {
      clearTimeout(t);
      resolve(ack || { ok: false, error: 'empty ack' });
    });
  });

const idsOf = (peers = []) => peers.map((p) => String(p.userId || p.user || '')).filter(Boolean);

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

  const HOST = await makeUser('mhost');
  const B = await makeUser('bee');
  const C = await makeUser('cee');
  const D = await makeUser('dee');

  // Only the host invites; the guests are strangers to one another.
  const created = await http('POST', '/meetings', {
    token: HOST.token,
    body: {
      title: 'Mesh room',
      startAt: new Date(Date.now() + 60_000).toISOString(),
      durationMinutes: 30,
      type: 'video',
      participants: [B.id, C.id, D.id],
      settings: { askToJoin: false, joinAnytime: true },
    },
  });
  check('the meeting is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const meetingId = created.data?.meeting?._id;

  const sh = await connect(HOST.token);
  const sb = await connect(B.token);
  const sc = await connect(C.token);
  const sd = await connect(D.token);

  /* ── Two in the room ────────────────────────────────────────────── */
  section('Host and B join');
  const hostAck = await joinMeeting(sh, meetingId);
  check('the host joins', hostAck.ok === true, JSON.stringify(hostAck).slice(0, 120));
  check('the first joiner sees an EMPTY peer list', (hostAck.peers || []).length === 0, JSON.stringify(hostAck.peers));

  const bJoinedAtHost = waitFor(sh, 'meeting:peer-joined');
  const bAck = await joinMeeting(sb, meetingId);
  check('B joins', bAck.ok === true);
  check('B’s ack lists the host already present', idsOf(bAck.peers).includes(String(HOST.id)), JSON.stringify(idsOf(bAck.peers)));
  check('the host is told B joined', !!(await bJoinedAtHost));

  /* ── The third joiner: the case that broke in CALLS ─────────────── */
  section('C joins a room that already has TWO people');
  const cJoinedAtHost = waitFor(sh, 'meeting:peer-joined');
  const cJoinedAtB = waitFor(sb, 'meeting:peer-joined');
  const cAck = await joinMeeting(sc, meetingId);
  check('C joins', cAck.ok === true);

  const cSees = idsOf(cAck.peers);
  check('C’s ack lists the HOST', cSees.includes(String(HOST.id)), JSON.stringify(cSees));
  check('C’s ack ALSO lists B (not just the host)', cSees.includes(String(B.id)), JSON.stringify(cSees));
  check('C is given exactly the two people present', cSees.length === 2, `${cSees.length}`);

  check('the host is told C joined', !!(await cJoinedAtHost));
  check('B is ALSO told C joined (the call-mesh failure point)', !!(await cJoinedAtB), 'B never learned about C');

  /* ── Can the two guests signal each other directly? ─────────────── */
  section('B ↔ C media signalling (never invited each other, not contacts)');
  const bSocketId = (cAck.peers || []).find((p) => String(p.userId) === String(B.id))?.socketId;
  const cSocketId = sc.id;
  check('C knows B’s socket id from the ack', !!bSocketId, JSON.stringify(cAck.peers));

  const sigAtB = waitFor(sb, 'meeting:signal');
  sc.emit('meeting:signal', { meetingId, to: bSocketId, data: { type: 'offer', sdp: 'v=0 c-to-b' } });
  const gotSig = await sigAtB;
  check('C→B signal is relayed', !!gotSig && gotSig.data?.sdp === 'v=0 c-to-b', 'dropped — B and C could never connect');
  check('the relayed signal identifies the sender socket', String(gotSig?.from || '') === String(cSocketId), `${gotSig?.from}`);

  const sigAtC = waitFor(sc, 'meeting:signal');
  sb.emit('meeting:signal', { meetingId, to: cSocketId, data: { type: 'answer', sdp: 'v=0 b-to-c' } });
  check('B→C signal is relayed (both directions)', !!(await sigAtC));

  /* ── A fourth participant ───────────────────────────────────────── */
  section('D joins a room of three');
  const dAtHost = waitFor(sh, 'meeting:peer-joined');
  const dAtB = waitFor(sb, 'meeting:peer-joined');
  const dAtC = waitFor(sc, 'meeting:peer-joined');
  const dAck = await joinMeeting(sd, meetingId);
  check('D joins', dAck.ok === true);

  const dSees = idsOf(dAck.peers);
  check('D sees ALL three already present', dSees.length === 3, `${dSees.length}: ${JSON.stringify(dSees)}`);
  check('…including both guests, not just the host', dSees.includes(String(B.id)) && dSees.includes(String(C.id)));
  check('the host is told D joined', !!(await dAtHost));
  check('B is told D joined', !!(await dAtB));
  check('C is told D joined', !!(await dAtC));

  /* Every pair must be addressable — the actual definition of a full mesh. */
  const socketIds = new Map((dAck.peers || []).map((p) => [String(p.userId), p.socketId]));
  const reachB = waitFor(sb, 'meeting:signal');
  sd.emit('meeting:signal', { meetingId, to: socketIds.get(String(B.id)), data: { probe: 'd-to-b' } });
  check('D can signal B directly', !!(await reachB));
  const reachC = waitFor(sc, 'meeting:signal');
  sd.emit('meeting:signal', { meetingId, to: socketIds.get(String(C.id)), data: { probe: 'd-to-c' } });
  check('D can signal C directly', !!(await reachC));

  /* ── Leaving ────────────────────────────────────────────────────── */
  section('One leaves — does EVERYONE learn?');
  const leftAtHost = waitFor(sh, 'meeting:peer-left');
  const leftAtB = waitFor(sb, 'meeting:peer-left');
  const leftAtC = waitFor(sc, 'meeting:peer-left');
  sd.emit('meeting:leave', { meetingId });
  check('the host is told D left', !!(await leftAtHost));
  check('B is told D left', !!(await leftAtB));
  check('C is told D left (no stale tile left behind)', !!(await leftAtC));

  /* ── Isolation: a stranger cannot inject into the room ──────────── */
  section('Room isolation');
  const OUT = await makeUser('outsider');
  const so = await connect(OUT.token);
  const leaked = waitFor(sb, 'meeting:signal', 2500);
  so.emit('meeting:signal', { meetingId, to: sb.id, data: { probe: 'intruder' } });
  check('a NON-MEMBER cannot signal into the room', !(await leaked), 'an outsider reached a participant');

  [sh, sb, sc, sd, so].forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(58)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

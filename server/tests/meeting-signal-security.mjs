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

const PORT = 5127;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mtgsigsec$2');
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
  const phone = `+1555${String(9_710_000 + phoneSeq++).slice(0, 7)}`;
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

const noEvent = async (socket, event, ms = 2500) => (await waitFor(socket, event, ms)) === null;

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const VICTIM = await makeUser('victim');
  const PEER = await makeUser('peer');
  const ATTACKER = await makeUser('attacker');

  const mk = async (owner, participants, title) => {
    const r = await http('POST', '/meetings', {
      token: owner.token,
      body: {
        title, startAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, type: 'video',
        participants, settings: { askToJoin: false, joinAnytime: true },
      },
    });
    if (r.status !== 201) throw new Error(`create meeting failed: ${r.status} ${r.data?.message}`);
    return r.data.meeting._id;
  };
  const victimMeeting = await mk(VICTIM, [PEER.id], 'Private board meeting');
  const attackerMeeting = await mk(ATTACKER, [], 'Attacker room');

  const sv = await connect(VICTIM.token);
  const sp = await connect(PEER.token);
  const sa = await connect(ATTACKER.token);

  section('Setup');
  check('victim joins their own meeting', (await joinMeeting(sv, victimMeeting)).ok);
  check('peer joins the victim meeting', (await joinMeeting(sp, victimMeeting)).ok);
  check('attacker joins ONLY their own meeting', (await joinMeeting(sa, attackerMeeting)).ok);

  const offer = { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0 fake' } };

  section('Cross-meeting signal injection is blocked');
  let p = noEvent(sv, 'meeting:signal');
  sa.emit('meeting:signal', { meetingId: attackerMeeting, to: `user:${VICTIM.id}`, data: offer });
  check('offer addressed to user:<victim> is NOT delivered', await p);

  p = noEvent(sv, 'meeting:signal');
  const pp = noEvent(sp, 'meeting:signal');
  sa.emit('meeting:signal', { meetingId: attackerMeeting, to: `mtg:${victimMeeting}`, data: offer });
  check('offer addressed to mtg:<other meeting> is NOT delivered (victim)', await p);
  check('offer addressed to mtg:<other meeting> is NOT delivered (peer)', await pp);

  p = noEvent(sv, 'meeting:signal');
  sa.emit('meeting:signal', { meetingId: attackerMeeting, to: sv.id, data: offer });
  check('offer addressed to the victim socket id (other meeting) is NOT delivered', await p);

  p = noEvent(sv, 'meeting:signal');
  sa.emit('meeting:signal', { meetingId: victimMeeting, to: sv.id, data: offer });
  check('claiming a meeting the attacker is not in is rejected', await p);

  section('Host moderation cannot reach outsiders');
  p = noEvent(sv, 'meeting:force-mute');
  sa.emit('meeting:force-mute', { meetingId: attackerMeeting, toUser: VICTIM.id });
  check('force-mute toUser outside the meeting is NOT delivered', await p);
  p = noEvent(sv, 'meeting:force-mute');
  sa.emit('meeting:force-mute', { meetingId: attackerMeeting, to: `user:${VICTIM.id}` });
  check('force-mute to a room name is NOT delivered', await p);
  p = noEvent(sv, 'meeting:admitted');
  sa.emit('meeting:admit', { meetingId: attackerMeeting, socketId: sv.id, userId: ATTACKER.id, allow: true });
  check('admit pass for a different user is NOT sent to the victim socket', await p);

  section('Legitimate signalling still works, in order');
  const got = [];
  const done = new Promise((resolve) => {
    const on = (msg) => { got.push(msg); if (got.length === 6) { sp.off('meeting:signal', on); resolve(); } };
    sp.on('meeting:signal', on);
    setTimeout(resolve, 6000);
  });
  sv.emit('meeting:signal', { meetingId: victimMeeting, to: sp.id, data: offer });
  for (let i = 0; i < 5; i += 1) sv.emit('meeting:signal', { meetingId: victimMeeting, to: sp.id, data: { kind: 'candidate', i } });
  await done;
  check('peer in the same meeting receives all 6 signals', got.length === 6, `got ${got.length}`);
  check('signals arrive from the right socket', got.every((m) => m.from === sv.id));
  check('offer is delivered before its ICE candidates, in order',
    got[0]?.data?.kind === 'offer' && got.slice(1).every((m, i) => m.data?.i === i), JSON.stringify(got.map((m) => m.data?.kind + (m.data?.i ?? ''))));

  const mute = waitFor(sp, 'meeting:force-mute');
  sv.emit('meeting:force-mute', { meetingId: victimMeeting, toUser: PEER.id });
  check('host force-mute (toUser) still reaches a peer in the room', Boolean(await mute));
  const mute2 = waitFor(sp, 'meeting:force-mute');
  sv.emit('meeting:force-mute', { meetingId: victimMeeting, to: sp.id });
  check('host force-mute (socket id) still reaches a peer in the room', Boolean(await mute2));

  [sv, sp, sa].forEach((s) => s.disconnect());
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

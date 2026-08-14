/**
 * Real-time proof for the in-MEETING collaboration layer.
 *
 * `realtime-coverage.mjs` showed 13 `meeting:*` events with no socket-level test
 * at all — the entire meeting-room experience (who is here, chat, raised hands,
 * reactions, mute-all, admit/deny) rests on those, and none of it has a REST
 * fallback: if the event does not arrive, the feature simply does not exist for
 * that participant. There is nothing to "refresh" your way out of.
 *
 * Two contract details that matter for setup:
 *   · a meeting with `askToJoin` left on makes a non-invited guest KNOCK instead
 *     of joining, so the host must either invite them or turn it off;
 *   · `meeting:join` answers through an acknowledgement callback, so the suite
 *     waits on that ack rather than guessing at a delay.
 *
 * Run:  node tests/meeting-room-realtime.mjs   (from /server)
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

const PORT = 5119;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mtgrt$2');
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
  const phone = `+1555${String(9_300_000 + phoneSeq++).slice(0, 7)}`;
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

/** NULL on timeout, so a missing emit is a failure rather than a hang. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/** `meeting:join` replies through an ack callback. */
const joinMeeting = (socket, meetingId, ms = 8000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), ms);
    socket.emit('meeting:join', { meetingId }, (ack) => {
      clearTimeout(t);
      resolve(ack || { ok: false, error: 'empty ack' });
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

  const HOST = await makeUser('mhost');
  const GUEST = await makeUser('mguest');

  /* Invite the guest AND turn off ask-to-join, so this suite tests the
     collaboration events rather than the knock/admit gate (which has its own
     coverage in the meeting suites). */
  const created = await http('POST', '/meetings', {
    token: HOST.token,
    body: {
      title: 'Realtime room',
      startAt: new Date(Date.now() + 60_000).toISOString(),
      durationMinutes: 30,
      type: 'video',
      participants: [GUEST.id],
      settings: { askToJoin: false, joinAnytime: true },
    },
  });
  check('a meeting is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const meetingId = created.data?.meeting?._id;

  const sh = await connect(HOST.token);
  const sg = await connect(GUEST.token);

  /* ── Joining: does the room learn about a new peer? ─────────────── */
  section('Joining the room');
  const hostAck = await joinMeeting(sh, meetingId);
  check('the host can join', hostAck.ok === true, JSON.stringify(hostAck).slice(0, 140));

  const peerJoinedAtHost = waitFor(sh, 'meeting:peer-joined');
  const guestAck = await joinMeeting(sg, meetingId);
  check('the guest can join', guestAck.ok === true, JSON.stringify(guestAck).slice(0, 140));
  const joined = await peerJoinedAtHost;
  check('the host is told a peer JOINED (live participant list)', !!joined, 'no meeting:peer-joined event');
  check('the join payload identifies the peer', !!(joined?.socketId || joined?.userId), JSON.stringify(joined).slice(0, 120));

  /* ── The collaboration events ───────────────────────────────────── */
  section('In-meeting collaboration');
  const chatAtHost = waitFor(sh, 'meeting:chat');
  sg.emit('meeting:chat', { meetingId, text: 'hello from the guest' });
  const gotChat = await chatAtHost;
  check('meeting CHAT reaches the other participant', !!gotChat, 'no meeting:chat event');
  check('the chat payload carries the text', gotChat?.text === 'hello from the guest', JSON.stringify(gotChat?.text));

  const handAtHost = waitFor(sh, 'meeting:hand');
  sg.emit('meeting:hand', { meetingId, up: true });
  const gotHand = await handAtHost;
  check('a RAISED HAND reaches the host', !!gotHand && gotHand.up === true, JSON.stringify(gotHand));

  const reactionAtHost = waitFor(sh, 'meeting:reaction');
  sg.emit('meeting:reaction', { meetingId, emoji: '👏' });
  const gotReaction = await reactionAtHost;
  check('a REACTION reaches the host', !!gotReaction && !!gotReaction.emoji, JSON.stringify(gotReaction));

  /* ── Host controls ──────────────────────────────────────────────── */
  section('Host controls');
  const muteAtGuest = waitFor(sg, 'meeting:force-mute');
  sh.emit('meeting:mute-all', { meetingId });
  const gotMute = await muteAtGuest;
  check('MUTE-ALL from the host reaches the guest', !!gotMute, 'no meeting:force-mute event');

  const removedAtGuest = waitFor(sg, 'meeting:removed');
  /* The handler targets `to` (a socketId, for the mesh) or `toUser` (a userId, for
     the SFU where one user may hold several sockets) — not `socketId`. */
  sh.emit('meeting:remove', { meetingId, to: joined?.socketId });
  const gotRemoved = await removedAtGuest;
  check('REMOVE from the host reaches the removed guest', !!gotRemoved, 'no meeting:removed event');

  /* ── Leaving ────────────────────────────────────────────────────── */
  section('Leaving the room');
  const sg2 = await connect(GUEST.token);
  await joinMeeting(sg2, meetingId);
  await sleep(400);
  const peerLeftAtHost = waitFor(sh, 'meeting:peer-left');
  sg2.emit('meeting:leave', { meetingId });
  const gotLeft = await peerLeftAtHost;
  check('the host is told a peer LEFT', !!gotLeft, 'no meeting:peer-left event');

  sh.close();
  sg.close();
  sg2.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

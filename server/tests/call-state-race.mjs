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

const PORT = 5125;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_callrace$2');
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
  const phone = `+1555${String(9_750_000 + phoneSeq++).slice(0, 7)}`;
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

/*
 * Call state transitions are compare-and-set.
 *
 * transitionCall() used to read → mutate → save(). When the callee's `accept`
 * and the caller's `end` landed together on a still-ringing call, both acted on
 * the same "ringing" read and the last save won — so a call that connected
 * (answeredAt set) could be recorded as "missed". Fire both at once, many times,
 * and require every resulting record to tell ONE consistent story.
 */
async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}

const TRIALS = 15;
// Short reconnect grace for the spawned server, so the drop tests run quickly.
process.env.CALL_RECONNECT_GRACE_MS = '3000';
(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const caller = await makeUser('caller');
  const callee = await makeUser('callee');
  await befriend(caller, callee);
  const sc = await connect(caller.token);
  const sr = await connect(callee.token);
  const calls = mongoose.connection.collection('calls');

  section(`accept and end race, ${TRIALS} trials`);
  const bad = [];
  const outcomes = {};
  for (let i = 0; i < TRIALS; i += 1) {
    const st = await http('POST', '/calls/start', { token: caller.token, body: { receiverId: callee.id, callType: 'audio' } });
    const callId = st.data?.call?._id;
    if (!callId) { bad.push(`start failed ${st.status}`); continue; }
    sr.emit('call:accept', { to: caller.id, callId });
    sc.emit('call:end', { to: callee.id, callId, duration: 0 });
    await sleep(900);
    const doc = await calls.findOne({ _id: new mongoose.Types.ObjectId(callId) });
    outcomes[doc.status] = (outcomes[doc.status] || 0) + 1;
    const answered = Boolean(doc.answeredAt);
    // Consistent stories: never answered → missed; answered → accepted/completed.
    const ok = answered ? ['accepted', 'completed'].includes(doc.status) : doc.status === 'missed';
    if (!ok) bad.push(`#${i}: status=${doc.status} answeredAt=${doc.answeredAt ? 'set' : 'null'}`);
  }
  console.log('    outcomes:', JSON.stringify(outcomes));
  check('every record is consistent (no "missed" call that was answered)', bad.length === 0, bad.join('; '));

  section('transitionCall itself: accept and end issued together, 25 trials');
  const { transitionCall } = await import('../utils/callService.js');
  const { default: Call } = await import('../models/Call.js');
  const direct = [];
  const directOutcomes = {};
  for (let i = 0; i < 25; i += 1) {
    const c = await Call.create({
      initiator: caller.id, caller: caller.id, receiver: callee.id, type: 'audio', status: 'ringing',
      participants: [{ user: caller.id, status: 'joined' }, { user: callee.id, status: 'ringing' }],
    });
    await Promise.all([transitionCall(String(c._id), callee.id, 'accept'), transitionCall(String(c._id), caller.id, 'end')]);
    const d = await calls.findOne({ _id: c._id });
    directOutcomes[d.status] = (directOutcomes[d.status] || 0) + 1;
    const ok = d.answeredAt ? ['accepted', 'completed'].includes(d.status) : d.status === 'missed';
    if (!ok) direct.push(`#${i}: status=${d.status} answeredAt=${d.answeredAt ? 'set' : 'null'}`);
  }
  console.log('    outcomes:', JSON.stringify(directOutcomes));
  check('no record ends up "missed" after being answered', direct.length === 0, `${direct.length} bad: ${direct.slice(0, 3).join('; ')}`);

  section('Plain transitions still behave');
  const s1 = await http('POST', '/calls/start', { token: caller.token, body: { receiverId: callee.id, callType: 'video' } });
  const id1 = s1.data?.call?._id;
  sr.emit('call:accept', { to: caller.id, callId: id1 });
  await sleep(700);
  let d1 = await calls.findOne({ _id: new mongoose.Types.ObjectId(id1) });
  check('accept → accepted with answeredAt', d1.status === 'accepted' && Boolean(d1.answeredAt), d1.status);
  const end = await http('POST', '/calls/end', { token: caller.token, body: { callId: id1, duration: 42 } });
  d1 = await calls.findOne({ _id: new mongoose.Types.ObjectId(id1) });
  check('end → completed with the reported duration', end.status === 200 && d1.status === 'completed' && d1.duration === 42, `${d1.status} ${d1.duration}`);
  const again = await http('POST', '/calls/end', { token: callee.token, body: { callId: id1 } });
  check('a second end is a no-op on a terminal call', again.status === 200 && again.data?.call?.status === 'completed');

  const s2 = await http('POST', '/calls/start', { token: caller.token, body: { receiverId: callee.id, callType: 'audio' } });
  const rej = await http('POST', '/calls/reject', { token: callee.token, body: { callId: s2.data?.call?._id } });
  check('reject → rejected', rej.status === 200 && rej.data?.call?.status === 'rejected', rej.data?.call?.status);

  const s3 = await http('POST', '/calls/start', { token: caller.token, body: { receiverId: callee.id, callType: 'audio' } });
  const mis = await http('POST', '/calls/missed', { token: caller.token, body: { callId: s3.data?.call?._id } });
  check('missed → missed with endedAt', mis.status === 200 && mis.data?.call?.status === 'missed' && Boolean(mis.data?.call?.endedAt), mis.data?.call?.status);

  section('A brief signalling drop does not end a live call');
  const s4 = await http('POST', '/calls/start', { token: caller.token, body: { receiverId: callee.id, callType: 'audio' } });
  const id4 = s4.data?.call?._id;
  sr.emit('call:accept', { to: caller.id, callId: id4 });
  await sleep(800);
  const noEnd = waitFor(sc, 'call:ended', 4500);
  sr.disconnect(); // callee's Wi-Fi blips…
  await sleep(500);
  const sr2 = await connect(callee.token); // …and is back half a second later
  check('caller is NOT told the call ended during a blip', (await noEnd) === null);
  let d4 = await calls.findOne({ _id: new mongoose.Types.ObjectId(id4) });
  check('the call record is still live', d4.status === 'accepted', d4.status);

  section('…but a callee who never comes back is hung up after the grace period');
  const ended = waitFor(sc, 'call:ended', 8000);
  sr2.disconnect();
  const evt = await ended;
  check('caller gets call:ended (peer-disconnected) once the grace runs out', evt?.reason === 'peer-disconnected', JSON.stringify(evt));
  d4 = await calls.findOne({ _id: new mongoose.Types.ObjectId(id4) });
  check('the call record is closed as completed', d4.status === 'completed', d4.status);

  sc.disconnect();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

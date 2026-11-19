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

const PORT = 5126;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_concurrency$2');
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
  const phone = `+1555${String(9_740_000 + phoneSeq++).slice(0, 7)}`;
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
 * Concurrent writes must not lose updates.
 *
 * Polls, reactions and meeting votes used read → modify → save(). Two people
 * acting at the same moment both read the same version; one save then failed
 * with a VersionError (a 500 to the user) or — in the meeting socket handlers,
 * where errors were swallowed — silently overwrote the other's vote.
 */
async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}
const doc = (coll, id) => mongoose.connection.collection(coll).findOne({ _id: new mongoose.Types.ObjectId(String(id)) });

const N = 8;
(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const owner = await makeUser('owner');
  const others = [];
  for (let i = 1; i < N; i += 1) others.push(await makeUser(`m${i}`));
  for (const u of others) await befriend(owner, u);
  const everyone = [owner, ...others];
  const g = await http('POST', '/groups', { token: owner.token, body: { name: 'Busy group', members: others.map((u) => u.id) } });
  const chatId = g.data?.chat?._id;
  check('group of 8 created', g.status === 201, `${g.status} ${g.data?.message}`);

  section('8 people vote in a single-choice poll at the same instant');
  const p = await http('POST', '/messages/poll', { token: owner.token, body: { chatId, question: 'Lunch?', options: ['Pizza', 'Sushi'] } });
  const pollId = p.data?.message?._id;
  const votes = await Promise.all(everyone.map((u) => http('POST', `/messages/${pollId}/vote`, { token: u.token, body: { optionIndex: 0 } })));
  check('every vote request succeeds (no 500 / VersionError)', votes.every((r) => r.status === 200), votes.map((r) => r.status).join(','));
  const after = await doc('messages', pollId);
  check(`all ${N} votes are counted`, after.poll.options[0].votes.length === N, `${after.poll.options[0].votes.length}/${N}`);

  section('…then all switch their vote at once');
  const sw = await Promise.all(everyone.map((u) => http('POST', `/messages/${pollId}/vote`, { token: u.token, body: { optionIndex: 1 } })));
  check('every switch succeeds', sw.every((r) => r.status === 200), sw.map((r) => r.status).join(','));
  const after2 = await doc('messages', pollId);
  check('option 1 has all 8, option 0 has none (single choice holds)',
    after2.poll.options[1].votes.length === N && after2.poll.options[0].votes.length === 0,
    `opt0=${after2.poll.options[0].votes.length} opt1=${after2.poll.options[1].votes.length}`);
  const unvote = await http('POST', `/messages/${pollId}/vote`, { token: owner.token, body: { optionIndex: 1 } });
  check('re-clicking your own choice clears it', unvote.status === 200 && (await doc('messages', pollId)).poll.options[1].votes.length === N - 1);

  section('Multi-choice poll, concurrent toggles');
  const pm = await http('POST', '/messages/poll', { token: owner.token, body: { chatId, question: 'Days?', options: ['Mon', 'Tue', 'Wed'], multi: true } });
  const pmId = pm.data?.message?._id;
  const mv = await Promise.all(everyone.flatMap((u) => [0, 2].map((i) => http('POST', `/messages/${pmId}/vote`, { token: u.token, body: { optionIndex: i } }))));
  check('all 16 toggles succeed', mv.every((r) => r.status === 200), mv.map((r) => r.status).join(','));
  const am = await doc('messages', pmId);
  check('Mon and Wed each have 8 votes, Tue none',
    am.poll.options[0].votes.length === N && am.poll.options[2].votes.length === N && am.poll.options[1].votes.length === 0,
    am.poll.options.map((o) => o.votes.length).join('/'));

  section('8 people react to one message at the same instant');
  const msg = await http('POST', '/messages', { token: owner.token, body: { chatId, type: 'text', content: 'react to me' } });
  const msgId = msg.data?.message?._id;
  const rx = await Promise.all(everyone.map((u, i) => http('POST', `/messages/${msgId}/react`, { token: u.token, body: { emoji: i % 2 ? '👍' : '🎉' } })));
  check('every reaction succeeds', rx.every((r) => r.status === 200), rx.map((r) => r.status).join(','));
  const ar = await doc('messages', msgId);
  check(`all ${N} reactions are stored`, ar.reactions.length === N, `${ar.reactions.length}/${N}`);
  const toggled = await Promise.all(everyone.map((u, i) => http('POST', `/messages/${msgId}/react`, { token: u.token, body: { emoji: i % 2 ? '👍' : '🎉' } })));
  const ar2 = await doc('messages', msgId);
  check('re-clicking the same emoji removes it for everyone (toggle)', toggled.every((r) => r.status === 200) && ar2.reactions.length === 0, `${ar2.reactions.length} left`);
  await http('POST', `/messages/${msgId}/react`, { token: owner.token, body: { emoji: '🎉' } });
  const ch = await http('POST', `/messages/${msgId}/react`, { token: owner.token, body: { emoji: '❤️' } });
  check('changing emoji replaces (one reaction per user)', ch.status === 200 && ch.data?.message?.reactions?.length === 1 && ch.data.message.reactions[0].emoji === '❤️', JSON.stringify(ch.data?.message?.reactions));

  section('Meeting poll: 8 sockets vote at once');
  const mt = await http('POST', '/meetings', { token: owner.token, body: { title: 'Vote', startAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, type: 'video', participants: others.map((u) => u.id), settings: { askToJoin: false, joinAnytime: true } } });
  const meetingId = mt.data?.meeting?._id;
  const socks = [];
  for (const u of everyone) socks.push(await connect(u.token));
  for (const s of socks) await joinMeeting(s, meetingId);
  const created = waitFor(socks[1], 'meeting:polls');
  socks[0].emit('meeting:poll-create', { meetingId, question: 'Ship it?', options: ['Yes', 'No'], multi: false });
  const mpoll = (await created)?.polls?.[0];
  check('meeting poll created', Boolean(mpoll?._id));
  socks.forEach((s) => s.emit('meeting:poll-vote', { meetingId, pollId: mpoll?._id, choices: [0] }));
  await sleep(3000);
  const mdoc = await doc('meetings', meetingId);
  check(`all ${N} meeting votes are recorded`, mdoc?.polls?.[0]?.votes?.length === N, `${mdoc?.polls?.[0]?.votes?.length}/${N}`);
  socks.forEach((s) => s.emit('meeting:poll-vote', { meetingId, pollId: mpoll?._id, choices: [1] }));
  await sleep(3000);
  const mdoc2 = await doc('meetings', meetingId);
  check('re-voting replaces, never double-counts', mdoc2?.polls?.[0]?.votes?.length === N && mdoc2.polls[0].votes.every((v) => v.choices[0] === 1), `${mdoc2?.polls?.[0]?.votes?.length} rows`);

  section('Meeting Q&A: 8 sockets upvote at once');
  const qs = waitFor(socks[1], 'meeting:questions');
  socks[1].emit('meeting:qa-ask', { meetingId, text: 'When is launch?' });
  const qid = (await qs)?.questions?.[0]?._id;
  check('question asked', Boolean(qid));
  socks.forEach((s) => s.emit('meeting:qa-upvote', { meetingId, questionId: qid }));
  await sleep(3000);
  const qdoc = await doc('meetings', meetingId);
  check(`all ${N} upvotes are recorded`, qdoc?.questions?.[0]?.upvotes?.length === N, `${qdoc?.questions?.[0]?.upvotes?.length}/${N}`);
  socks[2].emit('meeting:qa-upvote', { meetingId, questionId: qid });
  await sleep(1500);
  check('upvoting again toggles it off', (await doc('meetings', meetingId)).questions[0].upvotes.length === N - 1);

  socks.forEach((s) => s.disconnect());
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

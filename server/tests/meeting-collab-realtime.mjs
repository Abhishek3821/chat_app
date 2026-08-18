/**
 * In-meeting collaboration over real sockets: polls, Q&A, live captions, and
 * the two halves of the knock/deny flow.
 *
 * These five were documented but unproven. Each is a "why didn't that appear?"
 * bug waiting to happen, and none of them can be caught by name-matching: the
 * event names were always consistent — what wasn't verified is that voting
 * actually re-broadcasts, that a denied guest is told, and that captions do NOT
 * echo to the speaker.
 *
 * Polls and Q&A are SERVER-AUTHORITATIVE: the whole collection is re-sent on
 * every change, so a client never merges deltas and a late joiner is correct
 * after a single event. The checks below assert on the whole array for that
 * reason.
 *
 * Run:  node tests/meeting-collab-realtime.mjs   (from /server)
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

const PORT = 5129;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env — cannot run.'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_collab$2');
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

/**
 * Wait for a payload that MATCHES, not merely for the next one.
 *
 * Polls and Q&A broadcast the whole collection to the whole room, so both
 * sockets receive every change — about 1ms apart. "Wait for the next
 * `meeting:polls` on the guest" therefore catches the tail of the PREVIOUS
 * operation whenever the waiter is attached inside that gap, and every
 * assertion after it is reading one event behind. That produced a very
 * convincing false failure: "the upvote wasn't broadcast", when the upvote had
 * broadcast fine and the waiter was simply holding the ask.
 *
 * Matching on the expected STATE removes the race entirely and says what the
 * test actually means — "wait until the poll reads closed" — instead of
 * depending on delivery order.
 */
function waitFor(socket, event, { match = () => true, ms = 8000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(null); }, ms);
    function onEvent(payload) {
      let ok = false;
      try { ok = !!match(payload); } catch { ok = false; }
      if (!ok) return; // not the state we're waiting for — keep listening
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload ?? {});
    }
    socket.on(event, onEvent);
  });
}
/** Resolve null if NOTHING matching arrives — used for the must-not-happen checks. */
const expectNone = (socket, event, ms = 3000) => waitFor(socket, event, { ms });

/** `meeting:join` answers through an ACK CALLBACK, not an event. */
function joinMeeting(socket, meetingId, pass) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); } }, 6000);
    socket.emit('meeting:join', { meetingId, ...(pass ? { pass } : {}) }, (ack) => {
      if (done) return;
      done = true; clearTimeout(t); resolve(ack || { ok: false });
    });
  });
}

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_800_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: { name: `${tag.toUpperCase()} Tester`, username: `${tag}${stamp}`, email: `${tag}${stamp}@test.local`, password, confirmPassword: password, phone },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name };
}

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const HOST = await makeUser('mchost');
  const GUEST = await makeUser('mcguest');

  /* ── Polls & Q&A: open meeting, both inside ─────────────────────── */
  const open = await http('POST', '/meetings', {
    token: HOST.token,
    body: { title: 'Collab', type: 'video', settings: { askToJoin: false, joinAnytime: true } },
  });
  const meetingId = open.data?.meeting?._id;
  check('(setup) meeting created', open.status === 201 && !!meetingId, `${open.status} ${open.data?.message}`);

  const sh = await connect(HOST.token);
  const sg = await connect(GUEST.token);
  const hostAck = await joinMeeting(sh, meetingId);
  const guestAck = await joinMeeting(sg, meetingId);
  check('(setup) host is in the room and recognised as host', hostAck.ok === true && hostAck.isHost === true, JSON.stringify(hostAck));
  check('(setup) guest is in the room', guestAck.ok === true, JSON.stringify(guestAck));

  section('Polls broadcast the whole list on every change');
  const created = waitFor(sg, 'meeting:polls', { match: (p) => p?.polls?.length === 1 });
  sh.emit('meeting:poll-create', { meetingId, question: 'Ship it?', options: ['Yes', 'No'], multi: false });
  const pollsAfterCreate = await created;
  check('a new poll reaches the other participant', !!pollsAfterCreate, 'no meeting:polls within 4s');
  check('the payload carries the whole list, not a delta', Array.isArray(pollsAfterCreate?.polls) && pollsAfterCreate.polls.length === 1, JSON.stringify(pollsAfterCreate));
  const pollId = pollsAfterCreate?.polls?.[0]?._id;
  check('the question and options survived', pollsAfterCreate?.polls?.[0]?.question === 'Ship it?' && pollsAfterCreate.polls[0].options?.length === 2);

  const voted = waitFor(sh, 'meeting:polls', { match: (p) => (p?.polls?.[0]?.votes || []).length === 1 });
  sg.emit('meeting:poll-vote', { meetingId, pollId, choices: [0] });
  const afterVote = await voted;
  check("a guest's vote is broadcast back to the host", !!afterVote, 'no meeting:polls after vote');
  check('and the vote is recorded on the poll', (afterVote?.polls?.[0]?.votes || []).length === 1, JSON.stringify(afterVote?.polls?.[0]?.votes));

  const closed = waitFor(sg, 'meeting:polls', { match: (p) => p?.polls?.[0]?.closed === true });
  sh.emit('meeting:poll-close', { meetingId, pollId });
  check('closing is broadcast too', (await closed)?.polls?.[0]?.closed === true);

  const guestClose = waitFor(sg, 'meeting:polls', { match: (p) => (p?.polls || []).length > 1, ms: 3000 });
  sg.emit('meeting:poll-create', { meetingId, question: 'Sneaky', options: ['a', 'b'] });
  check('a NON-host cannot create a poll (host-only, silently ignored)', (await guestClose) === null);

  section('Q&A broadcasts the whole list on every change');
  const asked = waitFor(sh, 'meeting:questions', { match: (p) => p?.questions?.length === 1 });
  sg.emit('meeting:qa-ask', { meetingId, text: 'When does it ship?', anonymous: false });
  const afterAsk = await asked;
  check('a question reaches the host', !!afterAsk, 'no meeting:questions within 4s');
  check('as the whole list', Array.isArray(afterAsk?.questions) && afterAsk.questions.length === 1, JSON.stringify(afterAsk));
  const questionId = afterAsk?.questions?.[0]?._id;

  const upvoted = waitFor(sg, 'meeting:questions', { match: (p) => (p?.questions?.[0]?.upvotes || []).length === 1 });
  sh.emit('meeting:qa-upvote', { meetingId, questionId });
  check('an upvote is broadcast', ((await upvoted)?.questions?.[0]?.upvotes || []).length === 1);

  const answered = waitFor(sg, 'meeting:questions', { match: (p) => p?.questions?.[0]?.answered === true });
  sh.emit('meeting:qa-answer', { meetingId, questionId, answerText: 'Friday.' });
  const afterAnswer = await answered;
  check('the answer reaches the asker', afterAnswer?.questions?.[0]?.answered === true, JSON.stringify(afterAnswer?.questions?.[0]));
  check('with the text', afterAnswer?.questions?.[0]?.answerText === 'Friday.');

  section('Live captions go to everyone EXCEPT the speaker');
  const heard = waitFor(sg, 'meeting:caption', { match: (p) => p?.text === 'hello everyone' });
  const echoed = expectNone(sh, 'meeting:caption', 2500);
  sh.emit('meeting:caption', { meetingId, text: 'hello everyone', final: true });
  const cap = await heard;
  check('the other participant receives the line', !!cap, 'no meeting:caption within 4s');
  check('attributed to the speaker', String(cap?.userId) === String(HOST.id) && !!cap?.name, JSON.stringify(cap));
  check('carrying the text and its final flag', cap?.text === 'hello everyone' && cap?.final === true);
  check('the SPEAKER does not receive their own caption back', (await echoed) === null);

  /* ── Knock / deny ───────────────────────────────────────────────── */
  section('A denied guest is told, and the host\'s other tabs stop asking');
  const locked = await http('POST', '/meetings', {
    token: HOST.token,
    body: { title: 'Locked', type: 'video', settings: { askToJoin: true, joinAnytime: true } },
  });
  const lockedId = locked.data?.meeting?._id;
  const sh2 = await connect(HOST.token); // host's first tab
  const sh3 = await connect(HOST.token); // host's second tab
  await joinMeeting(sh2, lockedId);
  await joinMeeting(sh3, lockedId);

  const sg2 = await connect(GUEST.token);
  const knockSeen = waitFor(sh2, 'meeting:knock', { match: (p) => String(p?.userId) === String(GUEST.id) });
  const guestAck2 = await joinMeeting(sg2, lockedId);
  check('an un-invited guest is made to knock, not admitted', guestAck2.ok === false && guestAck2.knocking === true, JSON.stringify(guestAck2));
  const knock = await knockSeen;
  check('the host is shown the knock', !!knock && String(knock.userId) === String(GUEST.id), JSON.stringify(knock));

  const denied = waitFor(sg2, 'meeting:denied', {});
  const handled = waitFor(sh3, 'meeting:knock-handled', {});
  sh2.emit('meeting:admit', { meetingId: lockedId, socketId: knock.socketId, userId: GUEST.id, allow: false });
  check('the guest is told they were denied', !!(await denied), 'no meeting:denied within 4s');
  const handledPayload = await handled;
  check("the host's OTHER tab clears the prompt", !!handledPayload, 'no meeting:knock-handled within 4s');
  check('and it identifies which knock', String(handledPayload?.socketId) === String(knock.socketId), JSON.stringify(handledPayload));

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

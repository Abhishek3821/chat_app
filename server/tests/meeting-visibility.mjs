/**
 * Meeting invitations: does the invitee actually SEE the meeting, get notified,
 * and can the host invite more people afterwards?
 *
 * Written for a reported bug: A scheduled a meeting with B, and B saw nothing —
 * no meeting in their list and no notification. The cause was that createMeeting
 * filtered invitees to the HOST'S WORKSPACE, so anyone outside it was silently
 * dropped from `participants`. Nothing errored; from A's side it looked sent.
 *
 * Also covers POST /meetings/:id/invite, which lets the host add people (by
 * contact and/or raw email) after the meeting already exists.
 *
 * Run:  node tests/meeting-visibility.mjs   (from /server)
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

const PORT = 5113;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mtg$2');
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
  const phone = `+1555${String(7_000_000 + phoneSeq++).slice(0, 7)}`;
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
const waitFor = (socket, event, ms = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }));

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
  const db = mongoose.connection.db;

  const A = await makeUser('host');
  const B = await makeUser('guest');
  const C = await makeUser('later');

  // Contacts, so the invite modal's contact list would include them.
  for (const [x, y] of [[A, B], [A, C]]) {
    await http('POST', `/contacts/request/${y.id}`, { token: x.token });
    const { data } = await http('GET', '/contacts/requests', { token: y.token });
    const req = (data.incoming || []).find((r) => String(r.from?._id) === String(x.id));
    if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: y.token, body: { action: 'accept' } });
  }

  /* The regression guard. Users created via signup have NO workspace, and the
     old code filtered invitees by `workspace: host.workspace`. Give the host a
     workspace so the two differ — which is exactly the situation that silently
     dropped the invitee, and what a real host with a workspace would hit. */
  const users = db.collection('users');
  const ws = new mongoose.Types.ObjectId();
  await users.updateOne({ _id: new mongoose.Types.ObjectId(A.id) }, { $set: { workspace: ws } });

  /* ── 1. Scheduling with an invitee ──────────────────────────────── */
  section('A schedules a meeting inviting B');
  const sb = await connect(B.token);
  const invitedEvent = settle(waitFor(sb, 'meeting-invited', 8000));

  const created = await http('POST', '/meetings', {
    token: A.token,
    body: {
      title: 'Design review',
      startAt: new Date(Date.now() + 3600_000).toISOString(),
      durationMinutes: 30,
      type: 'video',
      participants: [B.id],
      inviteEmails: ['outsider@example.com'],
    },
  });
  check('the meeting is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const meetingId = created.data.meeting._id;

  check(
    'B is stored as a participant (the workspace filter no longer drops them)',
    (created.data.meeting.participants || []).some((p) => String(p.user?._id || p.user) === String(B.id)),
    JSON.stringify(created.data.meeting.participants)
  );

  section('B sees it and is told about it');
  const listB = await http('GET', '/meetings', { token: B.token });
  check(
    'the meeting appears in B’s OWN meetings list',
    (listB.data.meetings || []).some((m) => String(m._id) === String(meetingId)),
    `${(listB.data.meetings || []).length} meeting(s) visible to B`
  );

  const ev = await invitedEvent;
  check('B receives the meeting-invited socket event live', ev.ok && String(ev.v?.meetingId) === String(meetingId), ev.e?.message);
  check('the event carries the title, so the toast is meaningful', ev.ok && ev.v?.title === 'Design review');

  await sleep(700); // notifyUser is off the request path
  const notifsB = await http('GET', '/notifications', { token: B.token });
  check(
    'B has a persisted meeting notification (for when they were offline)',
    (notifsB.data.notifications || []).some((n) => String(n.data?.meetingId) === String(meetingId) || /invited you/i.test(n.body || '')),
    JSON.stringify((notifsB.data.notifications || []).map((n) => n.body)).slice(0, 160)
  );
  check('email invitations were queued for the raw address too', (created.data.invitesQueued ?? 0) >= 1, `${created.data.invitesQueued}`);

  /* ── 2. Inviting more people afterwards ─────────────────────────── */
  section('Host invites more people AFTER scheduling');
  const sc = await connect(C.token);
  const cInvited = settle(waitFor(sc, 'meeting-invited', 8000));

  const invited = await http('POST', `/meetings/${meetingId}/invite`, {
    token: A.token,
    body: { userIds: [C.id], emails: ['newperson@example.com', 'not-an-email'] },
  });
  check('the invite call succeeds', invited.status === 200, `${invited.status} ${invited.data?.message}`);
  check('C is reported as added', (invited.data.added || []).some((u) => String(u.id) === String(C.id)));
  check('C is now a participant on the meeting', (invited.data.meeting.participants || []).some((p) => String(p.user?._id || p.user) === String(C.id)));
  check('the malformed email is dropped, the valid one queued', invited.data.invitesQueued === 2, `queued=${invited.data.invitesQueued} (C's own address + newperson)`);

  const listC = await http('GET', '/meetings', { token: C.token });
  check('the meeting now appears in C’s list', (listC.data.meetings || []).some((m) => String(m._id) === String(meetingId)));
  const cEv = await cInvited;
  check('C is notified live over the socket', cEv.ok && String(cEv.v?.meetingId) === String(meetingId), cEv.e?.message);

  section('Invite guards');
  const dup = await http('POST', `/meetings/${meetingId}/invite`, { token: A.token, body: { userIds: [C.id] } });
  check('re-inviting the same person adds nobody', (dup.data.added || []).length === 0);
  check('…and reports them as skipped', dup.data.skipped === 1, `skipped=${dup.data.skipped}`);

  const byGuest = await http('POST', `/meetings/${meetingId}/invite`, { token: B.token, body: { userIds: [C.id] } });
  check('a NON-HOST cannot invite people', byGuest.status === 403, `${byGuest.status}`);

  const empty = await http('POST', `/meetings/${meetingId}/invite`, { token: A.token, body: {} });
  check('an empty invite is rejected', empty.status === 400, `${empty.status}`);

  const badShape = await http('POST', `/meetings/${meetingId}/invite`, { token: A.token, body: { userIds: 'nope' } });
  check('a malformed userIds is rejected', badShape.status === 400, `${badShape.status}`);

  const ghost = await http('POST', `/meetings/${new mongoose.Types.ObjectId()}/invite`, { token: A.token, body: { emails: ['x@y.com'] } });
  check('inviting to a non-existent meeting 404s', ghost.status === 404, `${ghost.status}`);

  // Cancelled meetings cannot take new invitees.
  await http('DELETE', `/meetings/${meetingId}`, { token: A.token });
  const afterCancel = await http('POST', `/meetings/${meetingId}/invite`, { token: A.token, body: { emails: ['x@y.com'] } });
  check('inviting to a CANCELLED meeting is refused', afterCancel.status === 409, `${afterCancel.status}`);

  sb.close();
  sc.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

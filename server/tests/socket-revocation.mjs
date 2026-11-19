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

const PORT = 5128;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_sockrevoke$2');
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
  const phone = `+1555${String(9_720_000 + phoneSeq++).slice(0, 7)}`;
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
async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}

const noEvent = async (socket, event, ms = 2500) => (await waitFor(socket, event, ms)) === null;
const joinChat = async (s, chatId) => { s.emit('join-chat', chatId); await sleep(400); };

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const A = await makeUser('owner');
  const B = await makeUser('kicked');
  const C = await makeUser('leaver');
  const D = await makeUser('deleted');
  for (const u of [B, C, D]) await befriend(A, u);

  const created = await http('POST', '/groups', { token: A.token, body: { name: 'Revocation room', members: [B.id, C.id, D.id] } });
  check('group created with B, C and D', created.status === 201, `${created.status} ${created.data?.message}`);
  const chatId = created.data?.chat?._id;
  const leaked = (created.data?.chat?.participants || []).filter((p) => p.user?.email);
  check('group response does not leak member emails', leaked.length === 0, `${leaked.length} emails returned`);

  const sa = await connect(A.token);
  const sb = await connect(B.token);
  const sc = await connect(C.token);
  const sd = await connect(D.token);
  for (const s of [sa, sb, sc, sd]) await joinChat(s, chatId);

  const sent = await http('POST', '/messages', { token: A.token, body: { chatId, type: 'text', content: 'hello all' } });
  const msgId = sent.data?.message?._id;
  check('A sends a message', Boolean(msgId), `${sent.status} ${sent.data?.message}`);

  section('Control: every member gets live edits while in the group');
  let gotB = waitFor(sb, 'message-edited');
  await http('PATCH', `/messages/${msgId}`, { token: A.token, body: { content: 'edit 1' } });
  check('B receives the live edit before removal', Boolean(await gotB));

  section('Removed member is evicted from the live room');
  const rm = await http('DELETE', `/groups/${chatId}/members/${B.id}`, { token: A.token });
  check('A removes B', rm.status === 200, `${rm.status} ${rm.data?.message}`);
  await sleep(300);
  let noB = noEvent(sb, 'message-edited');
  let noBGroup = noEvent(sb, 'group-updated');
  await http('PATCH', `/messages/${msgId}`, { token: A.token, body: { content: 'edit 2 (B must not see)' } });
  check('removed B does NOT receive later edits', await noB);
  await http('POST', `/groups/${chatId}/members`, { token: A.token, body: { members: [] } }).catch(() => {});
  check('removed B does NOT receive group-updated (member list)', await noBGroup);
  let typing = noEvent(sa, 'typing-start');
  sb.emit('typing-start', { chatId });
  check('removed B can no longer inject typing into the group', await typing);

  section('Member who leaves is evicted too');
  const left = await http('POST', `/groups/${chatId}/leave`, { token: C.token });
  check('C leaves', left.status === 200, `${left.status} ${left.data?.message}`);
  await sleep(300);
  const noC = noEvent(sc, 'message-edited');
  await http('PATCH', `/messages/${msgId}`, { token: A.token, body: { content: 'edit 3' } });
  check('C does NOT receive edits after leaving', await noC);

  section('Socket reaction relay cannot forge reactions');
  const forged = noEvent(sa, 'message-reaction');
  sd.emit('message-reaction', { chatId, messageId: msgId, reactions: [{ user: A.id, emoji: '💩' }] });
  check('a client-emitted message-reaction is NOT relayed', await forged);
  const real = waitFor(sa, 'message-reaction');
  const r = await http('POST', `/messages/${msgId}/react`, { token: D.token, body: { emoji: '👍' } });
  check('the REST reaction still broadcasts live', r.status === 200 && Boolean(await real), `${r.status} ${r.data?.message}`);

  section('Live location obeys the same send rules as a message');
  const pol = await http('PATCH', `/groups/${chatId}`, { token: A.token, body: { messagingPolicy: 'admins' } });
  check('A makes the group admins-only', pol.status === 200, `${pol.status} ${pol.data?.message}`);
  const llD = await http('POST', '/live-location/start', { token: D.token, body: { chatId, lat: 12.9, lng: 77.6, durationSecs: 60 } });
  check('a plain member can NOT start live location in an admins-only group', llD.status === 403, `${llD.status} ${llD.data?.message}`);
  const llA = await http('POST', '/live-location/start', { token: A.token, body: { chatId, lat: 12.9, lng: 77.6, durationSecs: 60 } });
  check('the owner still can', llA.status === 201, `${llA.status} ${llA.data?.message}`);

  section('Deleted account loses its live socket');
  const dropped = waitFor(sd, 'disconnect', 5000);
  const del = await http('DELETE', '/users/me', { token: D.token });
  check('D deletes their account', del.status === 200, `${del.status} ${del.data?.message}`);
  check("D's open socket is disconnected by the server", (await dropped) === 'io server disconnect');

  section('Remaining members unaffected');
  const gotA = waitFor(sa, 'message-edited');
  await http('PATCH', `/messages/${msgId}`, { token: A.token, body: { content: 'edit 4' } });
  check('A (still a member) keeps receiving live edits', Boolean(await gotA));

  [sa, sb, sc, sd].forEach((s) => s.disconnect());
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

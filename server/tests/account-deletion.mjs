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

const PORT = 5124;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_acctdel$2');
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
  const phone = `+1555${String(9_760_000 + phoneSeq++).slice(0, 7)}`;
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

/*
 * Deleting an account leaves nothing dangling behind.
 *
 * deleteUserAccount() removed the user's own records but left other people's
 * data pointing at them: group previews at a deleted message, pins and replies
 * to deleted messages, breakout rooms of deleted meetings, empty communities,
 * and stale cached chat lists.
 */
async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}
const oid = (id) => new mongoose.Types.ObjectId(String(id));

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();
  const db = mongoose.connection;

  const A = await makeUser('stays');
  const B = await makeUser('alsostays');
  const D = await makeUser('leaving');
  await befriend(A, D);
  await befriend(A, B);

  const g = await http('POST', '/groups', { token: A.token, body: { name: 'Mixed', members: [B.id, D.id] } });
  const groupId = g.data?.chat?._id;
  check('group created', g.status === 201, `${g.status} ${g.data?.message}`);

  const first = await http('POST', '/messages', { token: A.token, body: { chatId: groupId, type: 'text', content: 'from A' } });
  const dMsg = await http('POST', '/messages', { token: D.token, body: { chatId: groupId, type: 'text', content: 'from D' } });
  const dMsgId = dMsg.data?.message?._id;
  const pin = await http('POST', `/messages/${dMsgId}/pin`, { token: A.token, body: { hours: 24 } });
  check('A pins D\'s message', pin.status === 200, `${pin.status} ${pin.data?.message}`);
  const reply = await http('POST', '/messages', { token: B.token, body: { chatId: groupId, type: 'text', content: 'replying to D', replyTo: dMsgId } });
  const replyId = reply.data?.message?._id;
  check('B replies to D\'s message', reply.status === 201, `${reply.status} ${reply.data?.message}`);
  // D speaks last, so D's message is the group preview at deletion time.
  const dLast = await http('POST', '/messages', { token: D.token, body: { chatId: groupId, type: 'text', content: 'D again' } });
  check('D\'s message is the group preview', String((await db.collection('chats').findOne({ _id: oid(groupId) })).lastMessage) === String(dLast.data?.message?._id));

  const mt = await http('POST', '/meetings', { token: D.token, body: { title: 'D hosts', startAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, type: 'video', participants: [A.id, B.id] } });
  const meetingId = mt.data?.meeting?._id;
  // The breakout API needs a live room full of people; create the two rooms
  // directly — what matters here is the parentMeeting link.
  const parent = await db.collection('meetings').findOne({ _id: oid(meetingId) });
  check('D hosts a meeting', Boolean(parent), `${mt.status} ${mt.data?.message}`);
  for (const i of [1, 2]) {
    await db.collection('meetings').insertOne({ ...parent, _id: new mongoose.Types.ObjectId(), roomCode: `${parent.roomCode}-b${i}`, title: `Room ${i}`, parentMeeting: parent._id });
  }
  check('breakouts exist', (await db.collection('meetings').countDocuments({ parentMeeting: oid(meetingId) })) === 2);

  const cm = await http('POST', '/communities', { token: D.token, body: { name: 'Only D' } });
  const communityId = cm.data?.community?._id;
  check('D creates a community only D is in', Boolean(communityId), `${cm.status} ${cm.data?.message}`);

  section('D deletes their account');
  const del = await http('DELETE', '/users/me', { token: D.token });
  check('deletion succeeds', del.status === 200, `${del.status} ${del.data?.message}`);

  const group = await db.collection('chats').findOne({ _id: oid(groupId) });
  check('the group survives for A and B', Boolean(group) && group.participants.length === 2);
  const preview = group && await db.collection('messages').findOne({ _id: group.lastMessage });
  check('group preview falls back to a message that still exists', Boolean(preview) && String(preview._id) === String(replyId), String(group?.lastMessage));
  check('no pin points at D\'s deleted message', !(group?.pins || []).some((p) => String(p.message) === String(dMsgId)));
  const r = await db.collection('messages').findOne({ _id: oid(replyId) });
  check('B\'s reply no longer references the deleted message', r && !r.replyTo, String(r?.replyTo));
  check('A\'s own message is untouched', Boolean(await db.collection('messages').findOne({ _id: oid(first.data?.message?._id) })));
  check('D\'s meeting is gone', !(await db.collection('meetings').findOne({ _id: oid(meetingId) })));
  check('…and so are its breakout rooms', (await db.collection('meetings').countDocuments({ parentMeeting: oid(meetingId) })) === 0);
  check('the community D was alone in is gone', !(await db.collection('communities').findOne({ _id: oid(communityId) })));
  const list = await http('GET', '/chats', { token: A.token });
  const row = (list.data?.chats || []).find((c) => String(c._id) === String(groupId));
  check('A\'s chat list shows the fallback preview', row && String(row.lastMessage?._id || row.lastMessage) === String(replyId), JSON.stringify(row?.lastMessage)?.slice(0, 80));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

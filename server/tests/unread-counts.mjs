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

const PORT = 5122;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_unread$2');
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
  const phone = `+1555${String(9_770_000 + phoneSeq++).slice(0, 7)}`;
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
 * Unread counts come from a per-user read watermark (utils/readState.js).
 *
 * They used to scan every message a chat had ever had (`readBy.user $ne me`,
 * which no index serves) on each chat-list load and each mark-read. Prove the
 * counts are still right in every case that matters — and that a long, fully
 * read history is no longer touched at all.
 */
async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const unread = async (user, chatId) => {
  const { data } = await http('GET', '/chats', { token: user.token });
  return (data?.chats || []).find((c) => String(c._id) === String(chatId))?.unreadCount;
};
const send = (user, chatId, content) => http('POST', '/messages', { token: user.token, body: { chatId, type: 'text', content } });

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();
  const db = mongoose.connection;

  const A = await makeUser('alice');
  const B = await makeUser('bob');
  const C = await makeUser('carol');
  await befriend(A, B);
  await befriend(A, C);
  const dm = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const dmId = dm.data?.chat?._id;
  check('direct chat A↔B', Boolean(dmId), `${dm.status} ${dm.data?.message}`);

  section('Basic counting');
  for (const t of ['one', 'two', 'three']) await send(A, dmId, t);
  check('B has 3 unread', (await unread(B, dmId)) === 3, String(await unread(B, dmId)));
  check('A (the sender) has 0 unread', (await unread(A, dmId)) === 0);
  const mr = await http('POST', '/messages/read', { token: B.token, body: { chatId: dmId } });
  check('mark-read (REST) succeeds', mr.status === 200, `${mr.status} ${mr.data?.message}`);
  check('…and B now has 0 unread', (await unread(B, dmId)) === 0, String(await unread(B, dmId)));
  const stamped = await db.collection('messages').countDocuments({ chat: oid(dmId), sender: oid(A.id), 'readBy.user': oid(B.id) });
  check('read receipts were stamped on all 3 messages', stamped === 3, `${stamped}/3`);

  section('New messages after a read');
  await send(A, dmId, 'four');
  await send(A, dmId, 'five');
  check('B has exactly the 2 new ones unread', (await unread(B, dmId)) === 2, String(await unread(B, dmId)));
  const sb = await connect(B.token);
  sb.emit('join-chat', dmId);
  await sleep(400);
  sb.emit('message:read', { chatId: dmId });
  await sleep(900);
  check('socket message:read clears them (and the cached list)', (await unread(B, dmId)) === 0, String(await unread(B, dmId)));
  const four = await db.collection('messages').findOne({ chat: oid(dmId), content: 'five' });
  check('…with a receipt on the new message', (four.readBy || []).some((r) => String(r.user) === String(B.id)));

  section('Deleted messages are not unread');
  const doomed = await send(A, dmId, 'oops');
  check('1 unread before the delete', (await unread(B, dmId)) === 1);
  await http('DELETE', `/messages/${doomed.data?.message?._id}?scope=everyone`, { token: A.token });
  const afterDel = await unread(B, dmId);
  const delDoc = await db.collection('messages').findOne({ _id: oid(doomed.data?.message?._id) });
  check('a message deleted for everyone stops counting', Boolean(delDoc?.isDeleted) && afterDel === 0, `unread=${afterDel} isDeleted=${delDoc?.isDeleted}`);

  section('Joining a group late does not make its history unread');
  const g = await http('POST', '/groups', { token: A.token, body: { name: 'Old group', members: [B.id] } });
  const gid = g.data?.chat?._id;
  for (let i = 0; i < 6; i += 1) await send(A, gid, `history ${i}`);
  await sleep(50);
  await http('POST', `/groups/${gid}/members`, { token: A.token, body: { members: [C.id] } });
  const cJoin = await unread(C, gid);
  check('C, added after 6 messages, does not see them as unread', cJoin <= 1, `unread=${cJoin}`);
  await send(A, gid, 'welcome C');
  check('…but does see what is sent after joining', (await unread(C, gid)) === cJoin + 1, String(await unread(C, gid)));

  section('Chats from before watermarks existed (no ChatRead row)');
  await http('POST', '/messages/read', { token: B.token, body: { chatId: gid } });
  await db.collection('chatreads').deleteMany({ user: oid(B.id), chat: oid(gid) });
  check('fully-read legacy chat counts 0 via the readBy fallback', (await unread(B, gid)) === 0);
  await sleep(500);
  check('…and gets its watermark written', Boolean(await db.collection('chatreads').findOne({ user: oid(B.id), chat: oid(gid) })));
  await send(A, gid, 'after migration');
  check('then counts new messages on the fast path', (await unread(B, gid)) === 1, String(await unread(B, gid)));
  await db.collection('chatreads').deleteMany({ user: oid(B.id), chat: oid(gid) });
  check('legacy chat with an unread message still counts it exactly', (await unread(B, gid)) === 1, String(await unread(B, gid)));

  section('A long, fully read history is not scanned');
  const old = new Date(Date.now() - 86_400_000);
  const bulk = Array.from({ length: 300 }, (_, i) => ({
    chat: oid(dmId), sender: oid(A.id), type: 'text', content: `bulk ${i}`, isDeleted: false,
    readBy: [{ user: oid(A.id), at: old }, { user: oid(B.id), at: old }], deliveredTo: [oid(A.id), oid(B.id)],
    deletedFor: [], reactions: [], createdAt: new Date(old.getTime() + i), updatedAt: old,
  }));
  await db.collection('messages').insertMany(bulk);
  await http('POST', '/messages/read', { token: B.token, body: { chatId: dmId } });
  await send(A, dmId, 'fresh 1');
  await send(A, dmId, 'fresh 2');
  check('B has exactly 2 unread over a 300+ message history', (await unread(B, dmId)) === 2, String(await unread(B, dmId)));
  const mark = (await db.collection('chatreads').findOne({ user: oid(B.id), chat: oid(dmId) })).lastReadAt;
  const plan = await db.collection('messages')
    .find({ chat: oid(dmId), createdAt: { $gt: mark }, sender: { $ne: oid(B.id) }, isDeleted: false, deletedFor: { $ne: oid(B.id) } })
    .explain('executionStats');
  const examined = plan.executionStats.totalDocsExamined;
  console.log(`    unread query examined ${examined} documents (chat holds ${await db.collection('messages').countDocuments({ chat: oid(dmId) })})`);
  check('the unread query examines only the new messages, not the history', examined <= 5, `examined ${examined}`);

  sb.disconnect();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

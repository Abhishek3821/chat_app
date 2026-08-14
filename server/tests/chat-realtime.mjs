/**
 * Real-time proof for the everyday chat actions.
 *
 * `realtime-coverage.mjs` showed only ~49% of server→client events had any
 * socket-level test. The gap included the actions a user performs constantly —
 * editing, deleting, reacting, pinning, voting in a poll — and for every one of
 * them a REST assertion passes while the peer still has to refresh. That is the
 * whole bug class, so these assertions wait on the OTHER user's socket.
 *
 * Template note: `waitFor` resolves NULL on timeout rather than rejecting, so a
 * missing emit is a reported failure instead of a hung suite.
 *
 * Run:  node tests/chat-realtime.mjs   (from /server)
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

const PORT = 5117;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
// Name-agnostic: survives a cluster swap or a URI with no database in the path.
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_chatrt$2');
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
  const phone = `+1555${String(9_100_000 + phoneSeq++).slice(0, 7)}`;
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

/** Resolves the payload, or NULL on timeout — a missing emit fails, never hangs. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
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

  const A = await makeUser('alpha');
  const B = await makeUser('bravo');

  /* ── Contacts, asserted on the socket ───────────────────────────── */
  section('Contact requests');
  const sa = await connect(A.token);
  const sb = await connect(B.token);

  const reqAtB = waitFor(sb, 'contact-request');
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  const gotReq = await reqAtB;
  check('B is told about the incoming contact request live', !!gotReq, 'no contact-request event');

  const { data: reqs } = await http('GET', '/contacts/requests', { token: B.token });
  const rid = (reqs.incoming || []).find((r) => String(r.from?._id) === String(A.id))?._id;
  const acceptedAtA = waitFor(sa, 'contact-accepted');
  await http('PATCH', `/contacts/request/${rid}`, { token: B.token, body: { action: 'accept' } });
  const gotAccepted = await acceptedAtA;
  check('A is told the request was accepted live', !!gotAccepted, 'no contact-accepted event');

  /* ── A chat to work in ──────────────────────────────────────────── */
  const { data: chatRes } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes.chat._id;
  sa.emit('join-chat', chatId);
  sb.emit('join-chat', chatId);
  await sleep(400);

  const sent = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'original text' } });
  const messageId = sent.data.message._id;
  check('a message can be sent', sent.status === 201, `${sent.status}`);

  /* ── Edit / delete / react — the everyday actions ───────────────── */
  section('Message edit, delete and reactions');
  const editedAtB = waitFor(sb, 'message-edited');
  const edit = await http('PATCH', `/messages/${messageId}`, { token: A.token, body: { content: 'edited text' } });
  const gotEdit = await editedAtB;
  check('the edit is accepted', edit.status === 200, `${edit.status} ${edit.data?.message}`);
  check('B sees the EDIT live (no refresh)', !!gotEdit, 'no message-edited event');
  check('the edited payload carries the new text', gotEdit?.message?.content === 'edited text', JSON.stringify(gotEdit?.message?.content));

  const reactedAtB = waitFor(sb, 'message-reaction');
  const react = await http('POST', `/messages/${messageId}/react`, { token: A.token, body: { emoji: '👍' } });
  const gotReact = await reactedAtB;
  check('the reaction is accepted', react.status === 200, `${react.status}`);
  check('B sees the REACTION live', !!gotReact, 'no message-reaction event');
  check('the payload names the message', String(gotReact?.messageId || '') === String(messageId));

  const pinnedAtB = waitFor(sb, 'message-pinned');
  // The field is `hours`, not `durationHours` — assertValidDuration reads req.body.hours.
  const pin = await http('POST', `/messages/${messageId}/pin`, { token: A.token, body: { hours: 1 } });
  const gotPin = await pinnedAtB;
  check('the pin is accepted', pin.status === 200 || pin.status === 201, `${pin.status} ${pin.data?.message}`);
  check('B sees the PIN live', !!gotPin, 'no message-pinned event');

  const unpinnedAtB = waitFor(sb, 'message-pinned');
  await http('DELETE', `/messages/${messageId}/pin`, { token: A.token });
  const gotUnpin = await unpinnedAtB;
  check('B sees the UNPIN live', !!gotUnpin && gotUnpin.pinned === false, JSON.stringify(gotUnpin));

  const deletedAtB = waitFor(sb, 'message-deleted');
  const del = await http('DELETE', `/messages/${messageId}?scope=everyone`, { token: A.token });
  const gotDel = await deletedAtB;
  check('delete-for-everyone is accepted', del.status === 200, `${del.status} ${del.data?.message}`);
  check('B sees the DELETE live', !!gotDel, 'no message-deleted event');

  /* ── Poll votes (message-updated) ───────────────────────────────── */
  section('Poll votes');
  /* Polls have their OWN endpoint — 'poll' is not in USER_MESSAGE_TYPES, so
     POST /messages with that type is correctly refused as an invalid type. */
  const poll = await http('POST', '/messages/poll', {
    token: A.token,
    body: { chatId, question: 'Lunch?', options: ['Pizza', 'Sushi'], multi: false },
  });
  const pollId = poll.data?.message?._id;
  if (!pollId) {
    check('a poll can be created', false, JSON.stringify(poll.data)?.slice(0, 140));
  } else {
    check('a poll can be created', true);
    const votedAtA = waitFor(sa, 'message-updated');
    const vote = await http('POST', `/messages/${pollId}/vote`, { token: B.token, body: { optionIndex: 0 } });
    const gotVote = await votedAtA;
    check('the vote is accepted', vote.status === 200, `${vote.status} ${vote.data?.message}`);
    check('A sees the VOTE live', !!gotVote, 'no message-updated event');
  }

  /* ── Chat-level settings that must reach the peer ───────────────── */
  section('Chat settings');
  const disappearingAtB = waitFor(sb, 'chat-disappearing');
  const dis = await http('PATCH', `/chats/${chatId}/disappearing`, { token: A.token, body: { seconds: 86400 } });
  const gotDis = await disappearingAtB;
  check('disappearing timer is accepted', dis.status === 200, `${dis.status}`);
  check('B sees the disappearing timer change live', !!gotDis && gotDis.seconds === 86400, JSON.stringify(gotDis));

  /* ── Multi-device: my OWN other devices ─────────────────────────── */
  section('Multi-device echo (a second device of the same user)');
  const sa2 = await connect(A.token); // A's "other tab"
  await sleep(300);

  const flagAtA2 = waitFor(sa2, 'chat-flag');
  const flag = await http('POST', `/users/me/chats/${chatId}/pin`, { token: A.token });
  const gotFlag = await flagAtA2;
  check('pinning a chat is accepted', flag.status === 200, `${flag.status} ${flag.data?.message}`);
  check("A's OTHER device sees the chat pin live", !!gotFlag, 'no chat-flag event');

  const themeAtA2 = waitFor(sa2, 'chat-theme');
  const theme = await http('PUT', `/users/me/chats/${chatId}/theme`, { token: A.token, body: { wallpaper: 'aurora' } });
  const gotTheme = await themeAtA2;
  check('setting a wallpaper is accepted', theme.status === 200, `${theme.status}`);
  check("A's OTHER device sees the wallpaper change live", !!gotTheme && gotTheme.wallpaper === 'aurora', JSON.stringify(gotTheme));

  /* ── Group rename ───────────────────────────────────────────────── */
  section('Group updates');
  const { data: groupRes } = await http('POST', '/groups', { token: A.token, body: { name: 'Before', members: [B.id] } });
  const groupId = groupRes?.chat?._id;
  check('a group can be created', !!groupId, JSON.stringify(groupRes)?.slice(0, 120));
  if (groupId) {
    sb.emit('join-chat', groupId);
    await sleep(300);
    const renamedAtB = waitFor(sb, 'group-updated');
    const ren = await http('PATCH', `/groups/${groupId}`, { token: A.token, body: { name: 'After' } });
    const gotRen = await renamedAtB;
    check('the rename is accepted', ren.status === 200, `${ren.status} ${ren.data?.message}`);
    check('B sees the group rename live', !!gotRen, 'no group-updated event');
  }

  sa.close();
  sa2.close();
  sb.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

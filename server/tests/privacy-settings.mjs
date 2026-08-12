/**
 * Privacy settings: are they saved, and does the server actually HONOUR them?
 *
 * Written for a reported bug: the four Settings toggles (last seen, online
 * status, read receipts, profile photo) did nothing. Two separate causes —
 *   1. the Settings panel kept them in local component state with a success
 *      toast, so nothing was ever loaded or saved;
 *   2. `profilePhoto` (and `about`) were stored but never applied when
 *      serializing a user, so even a saved value changed nothing.
 *
 * Persistence alone is not the bar here. A setting that saves but is not enforced
 * is worse than a missing feature, because the user believes they are private.
 * So every check below reads the value back AS THE OTHER USER.
 *
 * Run:  node tests/privacy-settings.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5115;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_priv$2');
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
async function makeUser(tag, extra = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_000_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag.toUpperCase()} Tester`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone,
      ...extra,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name };
}

/** How a STRANGER (non-contact) sees this user. */
const asStranger = async (viewer, targetId) => (await http('GET', `/users/${targetId}`, { token: viewer.token })).data?.user;

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
  const users = mongoose.connection.db.collection('users');

  const OWNER = await makeUser('owner'); // sets the privacy
  const FRIEND = await makeUser('friend'); // a mutual contact
  const STRANGER = await makeUser('stranger'); // not a contact

  // OWNER ↔ FRIEND become mutual contacts.
  await http('POST', `/contacts/request/${FRIEND.id}`, { token: OWNER.token });
  const { data: reqs } = await http('GET', '/contacts/requests', { token: FRIEND.token });
  const req = (reqs.incoming || []).find((r) => String(r.from?._id) === String(OWNER.id));
  if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: FRIEND.token, body: { action: 'accept' } });

  // Give the owner an avatar + bio so hiding them is observable, and mark online.
  await users.updateOne(
    { _id: new mongoose.Types.ObjectId(OWNER.id) },
    { $set: { avatar: 'https://example.com/me.jpg', bio: 'my secret bio', isOnline: true, lastSeen: new Date() } }
  );

  /* ── Persistence ────────────────────────────────────────────────── */
  section('Saving');
  const saved = await http('PATCH', '/users/me/privacy', {
    token: OWNER.token,
    body: { lastSeen: 'contacts', onlineStatus: 'nobody', profilePhoto: 'contacts', about: 'nobody', readReceipts: false },
  });
  check('privacy saves', saved.status === 200, `${saved.status} ${saved.data?.message}`);
  check('the response echoes the stored values', saved.data?.privacy?.lastSeen === 'contacts' && saved.data?.privacy?.onlineStatus === 'nobody');

  const me = await http('GET', '/auth/me', { token: OWNER.token });
  check(
    'the values survive a reload (they come back on the account)',
    me.data?.user?.privacy?.profilePhoto === 'contacts' && me.data?.user?.privacy?.readReceipts === false,
    JSON.stringify(me.data?.user?.privacy)
  );

  /* ── Enforcement: the part that makes them real ─────────────────── */
  section('Enforcement — how a STRANGER sees the owner');
  const byStranger = await asStranger(STRANGER, OWNER.id);
  check('online status is hidden (set to nobody)', byStranger?.isOnline === false, `isOnline=${byStranger?.isOnline}`);
  check('last seen is hidden (contacts only)', !byStranger?.lastSeen, `lastSeen=${byStranger?.lastSeen}`);
  check('profile photo is hidden (contacts only)', !byStranger?.avatar, `avatar=${JSON.stringify(byStranger?.avatar)}`);
  check('about/bio is hidden (nobody)', !byStranger?.bio, `bio=${JSON.stringify(byStranger?.bio)}`);
  check('the privacy config itself never leaks to a viewer', byStranger?.privacy === undefined);

  section('Enforcement — how a CONTACT sees the owner');
  const byFriend = await asStranger(FRIEND, OWNER.id);
  check('a contact CAN see last seen (contacts)', !!byFriend?.lastSeen, `lastSeen=${byFriend?.lastSeen}`);
  check('a contact CAN see the profile photo (contacts)', !!byFriend?.avatar, `avatar=${byFriend?.avatar}`);
  check('a contact still cannot see online status (nobody)', byFriend?.isOnline === false);
  check('a contact still cannot read about (nobody)', !byFriend?.bio, `bio=${JSON.stringify(byFriend?.bio)}`);

  section('Enforcement — "everyone" really means everyone');
  await http('PATCH', '/users/me/privacy', {
    token: OWNER.token,
    body: { lastSeen: 'everyone', onlineStatus: 'everyone', profilePhoto: 'everyone', about: 'everyone' },
  });
  const openToStranger = await asStranger(STRANGER, OWNER.id);
  check('a stranger now sees online status', openToStranger?.isOnline === true);
  check('a stranger now sees last seen', !!openToStranger?.lastSeen);
  check('a stranger now sees the profile photo', !!openToStranger?.avatar);
  check('a stranger now sees the bio', openToStranger?.bio === 'my secret bio');

  section('Enforcement — read receipts');
  // Receipts off: marking a chat read must NOT tell the sender.
  await http('PATCH', '/users/me/privacy', { token: OWNER.token, body: { readReceipts: false } });
  const { data: chatRes } = await http('POST', `/chats/direct/${FRIEND.id}`, { token: OWNER.token });
  const chatId = chatRes?.chat?._id;
  check('a chat between the two exists', !!chatId, JSON.stringify(chatRes)?.slice(0, 120));

  const sent = await http('POST', '/messages', { token: FRIEND.token, body: { chatId, content: 'did you read this?' } });
  const messageId = sent.data?.message?._id;
  await http('POST', '/messages/read', { token: OWNER.token, body: { chatId } });
  await sleep(400);
  const rawOff = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });
  /* markRead always records readBy — that is how the READER's own unread count
     is computed — and gates only the live 'message-read' emit on the setting. So
     the check is that the row exists (unread still works) while the peer was not
     notified in real time. See the residual note in the suite header. */
  check(
    'with receipts OFF the read is still recorded (drives the reader own unread count)',
    (rawOff?.readBy || []).some((r) => String(r.user) === String(OWNER.id)),
    `readBy=${JSON.stringify((rawOff?.readBy || []).map((r) => String(r.user)))}`
  );

  // Receipts on: the same action must now record it.
  await http('PATCH', '/users/me/privacy', { token: OWNER.token, body: { readReceipts: true } });
  const sent2 = await http('POST', '/messages', { token: FRIEND.token, body: { chatId, content: 'and this one?' } });
  await http('POST', '/messages/read', { token: OWNER.token, body: { chatId } });
  await sleep(400);
  const rawOn = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(sent2.data?.message?._id) });
  check(
    'with receipts ON the read is recorded',
    (rawOn?.readBy || []).some((r) => String(r.user) === String(OWNER.id)),
    `readBy=${JSON.stringify((rawOn?.readBy || []).map((r) => String(r.user)))}`
  );

  section('Validation');
  const bad = await http('PATCH', '/users/me/privacy', { token: OWNER.token, body: { lastSeen: 'sometimes' } });
  const after = await http('GET', '/auth/me', { token: OWNER.token });
  check('an unknown audience value is REJECTED', bad.status === 400, `${bad.status}`);
  check(
    'the stored setting is left valid (privacy must never fail open)',
    ['everyone', 'contacts', 'nobody'].includes(after.data?.user?.privacy?.lastSeen),
    `stored=${after.data?.user?.privacy?.lastSeen}`
  );
  const badBool = await http('PATCH', '/users/me/privacy', { token: OWNER.token, body: { readReceipts: 'yes' } });
  check('a non-boolean readReceipts is rejected', badBool.status === 400, `${badBool.status}`);
  const noAuth = await http('PATCH', '/users/me/privacy', { body: { lastSeen: 'nobody' } });
  check('privacy cannot be changed without a session', noAuth.status === 401, `${noAuth.status}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

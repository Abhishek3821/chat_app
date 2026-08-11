/**
 * End-to-end tests for the four features added on top of the audit findings:
 *   1. global search (people / chats / messages / meetings)
 *   2. starred messages (real list + pagination, not a count)
 *   3. in-chat search over the WHOLE history + jump-to-message context
 *   4. end-to-end encryption (identity, key distribution, sealed messages,
 *      rotation on membership change, and the server's inability to read)
 *   5. per-chat wallpaper persistence
 *
 * Runs the REAL server against an isolated database, and performs the client's
 * crypto with the very same module the browser ships (client/src/lib/e2ee.js)
 * under Node's WebCrypto — so this proves the actual wire contract, not a
 * re-implementation of it.
 *
 * Run:  node tests/search-e2ee-wallpaper.mjs   (from /server)
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.resolve(SERVER_DIR, '..', 'client');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

// The browser's crypto module, imported directly. If this file and the client
// ever drift, these tests break — which is the point.
const e2ee = await import(pathToFileURL(path.join(CLIENT_DIR, 'src', 'lib', 'e2ee.js')).href);

const PORT = 5103;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run tests.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_feat$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`— ${t}`);

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
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 300));
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

// Phone numbers must be unique across accounts, so hand out a distinct one per
// user from a fixed test range rather than a random draw that could collide.
let phoneSeq = 0;

/** Everything a test user needs, including a live E2EE identity. */
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const email = `${tag}${stamp}@test.local`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(2_000_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: { name: `${tag.toUpperCase()} Tester`, username: `${tag}${stamp}`, email, password, confirmPassword: password, phone },
  });
  if (status !== 201 || !data?.user?._id) {
    throw new Error(`signup for ${tag} failed (${status}): ${data?.message || JSON.stringify(data)}`);
  }
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name, email };
}

async function setupIdentity(user, passphrase) {
  const pair = await e2ee.generateIdentity();
  const publicKey = await e2ee.exportPublicKey(pair.publicKey);
  const wrapped = await e2ee.wrapIdentity(pair.privateKey, passphrase);
  const res = await http('POST', '/e2ee/identity', { token: user.token, body: { publicKey, ...wrapped } });
  user.keys = { pair, publicKey, wrapped };
  return res;
}

/** Seal a fresh chat key for every member — exactly what the client does. */
async function sealChatKeyFor(members) {
  const chatKey = await e2ee.generateChatKey();
  const keys = [];
  for (const m of members) keys.push({ user: m._id, ...(await e2ee.wrapChatKeyFor(chatKey, m.publicKey)) });
  return { chatKey, keys };
}

(async () => {
  // Same workaround as the main suite: the local resolver can't do SRV lookups
  // against Atlas, so point at public resolvers for the +srv URI.
  if (TEST_URI.includes('+srv')) {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch {
      /* noop */
    }
  }
  // Drop the database BEFORE the server boots, so its model registration
  // rebuilds the indexes (dropping afterwards would delete the text index the
  // server had just created, and silently test a degraded path).
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();
  const db = mongoose.connection.db;

  const A = await makeUser('alpha');
  const B = await makeUser('bravo');
  const C = await makeUser('carol');

  // Mutual contacts so direct chats are allowed.
  for (const [x, y] of [[A, B], [A, C], [B, C]]) {
    await http('POST', `/contacts/request/${y.id}`, { token: x.token });
    const { data } = await http('GET', '/contacts/requests', { token: y.token });
    const req = (data.incoming || []).find((r) => String(r.from?._id) === String(x.id));
    if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: y.token, body: { action: 'accept' } });
  }

  const { data: chatRes } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes.chat._id;

  /* ── 1. Global search ─────────────────────────────────────────── */
  section('Global search');
  await http('POST', '/messages', { token: A.token, body: { chatId, content: 'The quarterly pelican report is ready' } });
  await http('POST', '/messages', { token: B.token, body: { chatId, content: 'Thanks, reading the pelican notes now' } });
  await sleep(400);

  {
    const { status, data } = await http('GET', '/search?q=pelican', { token: A.token });
    check('GET /search returns 200', status === 200);
    check('finds messages by content', (data.messages || []).length >= 2, `got ${data.messages?.length}`);
    check('message rows carry their chat + sender', !!data.messages?.[0]?.chat && !!data.messages?.[0]?.sender);
  }
  {
    const { data } = await http('GET', `/search?q=${encodeURIComponent(B.email)}`, { token: A.token });
    check('finds a person by exact email', (data.people || []).some((p) => String(p._id) === String(B.id)));
    check('surfaces the direct chat with that person', (data.chats || []).some((c) => String(c._id) === String(chatId)));
  }
  {
    const { data } = await http('GET', '/search?q=a', { token: A.token });
    check('single-character query returns nothing (below threshold)', (data.messages || []).length === 0);
  }
  {
    // C is not in A and B's conversation and must not see its messages.
    const { data } = await http('GET', '/search?q=pelican', { token: C.token });
    check('search never leaks another conversation', (data.messages || []).length === 0);
  }
  {
    // Regression: `$text` THROWS when no text index exists (async index builds,
    // autoIndex off in prod, a restored collection). That used to 500 the whole
    // endpoint — every section, not just messages.
    let dropped = false;
    try {
      await db.collection('messages').dropIndex('content_text');
      dropped = true;
    } catch {
      /* already absent — the fallback is what's under test either way */
    }
    const { status, data } = await http('GET', '/search?q=pelican', { token: A.token });
    check('search survives a missing text index', status === 200);
    check('and still finds messages via the fallback', (data.messages || []).length >= 2, `got ${data.messages?.length}`);
    if (dropped) await db.collection('messages').createIndex({ content: 'text' });
  }

  /* ── 2. Starred messages ──────────────────────────────────────── */
  section('Starred messages');
  const { data: msgList } = await http('GET', `/messages/${chatId}`, { token: A.token });
  const first = msgList.messages[0];
  await http('POST', `/messages/${first._id}/star`, { token: A.token });
  {
    const { status, data } = await http('GET', '/messages/starred', { token: A.token });
    check('GET /messages/starred returns 200', status === 200);
    check('returns the starred row itself', data.messages?.some((m) => String(m._id) === String(first._id)));
    check('row carries chat context for navigation', !!data.messages?.[0]?.chat?._id);
    check('reports pagination state', typeof data.hasMore === 'boolean');
  }
  {
    const { data } = await http('GET', '/messages/starred', { token: B.token });
    check("another user's stars are not mine", !data.messages?.some((m) => String(m._id) === String(first._id)));
  }

  /* ── 3. In-chat search + jump-to-message context ──────────────── */
  section('In-chat search over full history');
  // Push the early message well out of any client-side window.
  for (let i = 0; i < 45; i += 1) {
    await http('POST', '/messages', { token: A.token, body: { chatId, content: `filler message ${i}` } });
  }
  const { data: needleRes } = await http('POST', '/messages', {
    token: A.token,
    body: { chatId, content: 'aardvark appears exactly once' },
  });
  const needleId = needleRes.message._id;
  for (let i = 0; i < 45; i += 1) {
    await http('POST', '/messages', { token: A.token, body: { chatId, content: `later message ${i}` } });
  }
  await sleep(300);

  {
    const { data: page } = await http('GET', `/messages/${chatId}?limit=40`, { token: A.token });
    check('default page does NOT contain the old message', !page.messages.some((m) => String(m._id) === String(needleId)));

    const { status, data } = await http('GET', `/messages/${chatId}/search?q=aardvark`, { token: A.token });
    check('in-chat search returns 200', status === 200);
    check('finds a message far outside the loaded page', data.messages?.some((m) => String(m._id) === String(needleId)));
    check('reports it was a server-side search', data.encrypted === false);
  }
  {
    const { status, data } = await http('GET', `/messages/${chatId}/context/${needleId}?radius=10`, { token: A.token });
    check('context window returns 200', status === 200);
    check('window contains the anchor', data.messages?.some((m) => String(m._id) === String(needleId)));
    check('window includes surrounding history', data.messages?.length > 10, `got ${data.messages?.length}`);
    check('reports it is a slice, not the whole chat', data.atStart === false);
  }
  {
    const { status } = await http('GET', `/messages/${chatId}/search?q=aardvark`, { token: C.token });
    check('non-member cannot search this chat', status === 403);
  }

  /* ── 4. End-to-end encryption ─────────────────────────────────── */
  section('E2EE — identity');
  {
    const { status } = await setupIdentity(A, 'alpha-pass-phrase');
    check('A publishes an identity', status === 200);
    await setupIdentity(B, 'bravo-pass-phrase');

    const { data } = await http('GET', '/e2ee/me', { token: A.token });
    check('identity round-trips for a second device', data.identity?.wrappedPrivateKey === A.keys.wrapped.wrappedPrivateKey);

    const unwrapped = await e2ee.unwrapIdentity(data.identity, 'alpha-pass-phrase');
    check('the stored blob really opens with the passphrase', !!unwrapped);

    const other = await e2ee.generateIdentity();
    const otherPub = await e2ee.exportPublicKey(other.publicKey);
    const clash = await http('POST', '/e2ee/identity', {
      token: A.token,
      body: { publicKey: otherPub, ...(await e2ee.wrapIdentity(other.privateKey, 'x'.repeat(9))) },
    });
    check('replacing an identity requires replace:true', clash.status === 409);

    const junk = await http('POST', '/e2ee/identity', {
      token: C.token,
      body: { publicKey: 'not base64 !!', wrappedPrivateKey: 'x', kdfSalt: 'x', kdfIterations: 10, wrapIv: 'x' },
    });
    check('malformed key material is rejected', junk.status === 400);
  }

  section('E2EE — enabling a chat');
  let chatKeyA;
  {
    const { data: members } = await http('GET', `/e2ee/chats/${chatId}/members`, { token: A.token });
    check('member keys are listed', members.members?.length === 2);
    check('nobody is missing an identity', (members.missing || []).length === 0);

    const { chatKey, keys } = await sealChatKeyFor(members.members);
    chatKeyA = chatKey;

    const partial = await http('POST', `/e2ee/chats/${chatId}/enable`, { token: A.token, body: { keys: [keys[0]] } });
    check('enabling with a key for only one member is rejected', partial.status === 400);

    const { status, data } = await http('POST', `/e2ee/chats/${chatId}/enable`, { token: A.token, body: { keys } });
    check('enable succeeds with a full key set', status === 200);
    check('key version starts at 1', data.e2ee?.version === 1);

    const again = await http('POST', `/e2ee/chats/${chatId}/enable`, { token: A.token, body: { keys } });
    check('cannot enable twice', again.status === 409);

    const outsider = await http('GET', `/e2ee/chats/${chatId}/keys`, { token: C.token });
    check('a non-member cannot fetch chat keys', outsider.status === 403);
  }

  section('E2EE — sealed messages');
  const SECRET = 'the vault code is 4815162342 🔐';
  let sealedId;
  {
    const plain = await http('POST', '/messages', { token: A.token, body: { chatId, content: SECRET } });
    check('plaintext into an encrypted chat is refused', plain.status === 409);

    const payload = await e2ee.encryptText(chatKeyA, SECRET);
    const stale = await http('POST', '/messages', { token: A.token, body: { chatId, enc: { ...payload, v: 99 } } });
    check('a stale key version is refused', stale.status === 409);

    const { status, data } = await http('POST', '/messages', { token: A.token, body: { chatId, enc: { ...payload, v: 1 } } });
    check('encrypted message accepted', status === 201);
    check('server stores it flagged as encrypted', data.message?.encrypted === true);
    check('server stores NO plaintext', data.message?.content === '');
    sealedId = data.message._id;
  }
  {
    // The real proof: read the raw document straight out of MongoDB.
    const raw = await db.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(sealedId) });
    check('database row holds no plaintext', !JSON.stringify(raw).includes('4815162342'));
    check('database row holds ciphertext', typeof raw.enc?.ct === 'string' && raw.enc.ct.length > 0);
  }
  {
    // B fetches their own wrapped copy and reads the message.
    const { data } = await http('GET', `/e2ee/chats/${chatId}/keys`, { token: B.token });
    check('B receives a wrapped key copy', data.keys?.length === 1);
    const bKey = await e2ee.unwrapChatKey(data.keys[0], B.keys.pair.privateKey);
    const { data: msgs } = await http('GET', `/messages/${chatId}?limit=5`, { token: B.token });
    const sealed = msgs.messages.find((m) => String(m._id) === String(sealedId));
    const text = await e2ee.decryptText(bKey, sealed.enc);
    check('B decrypts what A sent', text === SECRET);
  }
  {
    // Scheduling into a sealed chat would be delivered LATER by the server,
    // which holds no key — it would arrive in the clear. It must be refused.
    const later = new Date(Date.now() + 60_000).toISOString();
    const sched = await http('POST', '/messages/schedule', {
      token: A.token,
      body: { chatId, sendAt: later, content: 'would leak', type: 'text' },
    });
    check('scheduling is refused in an encrypted chat', sched.status === 409, `got ${sched.status}`);
    check('and explains why', /encrypt/i.test(sched.data?.message || ''), sched.data?.message);
  }
  {
    const { data } = await http('GET', `/messages/${chatId}/search?q=vault`, { token: A.token });
    check('server-side search reports it cannot search an encrypted chat', data.encrypted === true && data.messages.length === 0);

    const { data: g } = await http('GET', '/search?q=vault', { token: A.token });
    check('global search finds no plaintext for a sealed message', (g.messages || []).length === 0);
    check('global search flags the chat as encrypted instead', (g.encryptedChats || []).includes(String(chatId)));
  }

  section('E2EE — key rotation on membership change');
  {
    const { data: grp } = await http('POST', '/groups', { token: A.token, body: { name: 'Rotation Test', members: [B.id] } });
    const gid = grp.chat._id;
    const { data: m1 } = await http('GET', `/e2ee/chats/${gid}/members`, { token: A.token });
    const sealed1 = await sealChatKeyFor(m1.members);
    await http('POST', `/e2ee/chats/${gid}/enable`, { token: A.token, body: { keys: sealed1.keys } });

    const p1 = await e2ee.encryptText(sealed1.chatKey, 'before carol joined');
    await http('POST', '/messages', { token: A.token, body: { chatId: gid, enc: { ...p1, v: 1 } } });

    await setupIdentity(C, 'carol-pass-phrase');
    await http('POST', `/groups/${gid}/members`, { token: A.token, body: { members: [C.id] } });

    const { data: m2 } = await http('GET', `/e2ee/chats/${gid}/members`, { token: A.token });
    check('server reports the new member needs a key', m2.needsRotation === true);
    check('and names who', (m2.unkeyed || []).some((u) => String(u._id) === String(C.id)));

    const sealed2 = await sealChatKeyFor(m2.members);
    const { data: rot } = await http('POST', `/e2ee/chats/${gid}/rotate`, { token: A.token, body: { keys: sealed2.keys } });
    check('rotation mints version 2', rot.e2ee?.version === 2);

    const { data: ck } = await http('GET', `/e2ee/chats/${gid}/keys`, { token: C.token });
    check('the new member gets exactly one key version', ck.keys?.length === 1);
    check('and it is the CURRENT one, not the old one', ck.keys?.[0]?.version === 2);

    const { data: aKeys } = await http('GET', `/e2ee/chats/${gid}/keys`, { token: A.token });
    check('an original member keeps both versions', aKeys.keys?.length === 2);

    // Carol cannot read history sealed under v1 — the whole point of rotating.
    const carolKey = await e2ee.unwrapChatKey(ck.keys[0], C.keys.pair.privateKey);
    let readOldHistory = false;
    try {
      await e2ee.decryptText(carolKey, p1);
      readOldHistory = true;
    } catch {
      /* expected */
    }
    check('new member cannot read pre-join history', readOldHistory === false);

    const { data: m3 } = await http('GET', `/e2ee/chats/${gid}/members`, { token: A.token });
    check('rotation clears the needs-rotation flag', m3.needsRotation === false);
  }

  /* Attachments are sealed with the SAME chat key as the text, uploaded as an
     opaque .enc blob, and the nonce travels on the message. The point of this
     section is the pair of assertions that the bytes ON DISK are not the file
     and that they decrypt back to it — a sealed attachment whose plaintext is
     still sitting in /uploads would make the whole feature cosmetic. */
  section('E2EE — sealed attachments');
  {
    const PLAIN = Buffer.from('PNG fake-image-bytes-that-must-never-hit-the-disk', 'utf8');
    const { data: sealedBytes, iv } = await e2ee.encryptBytes(chatKeyA, PLAIN);

    const fd = new FormData();
    fd.append('files', new File([Buffer.from(sealedBytes)], 'holiday.enc', { type: 'application/octet-stream' }));
    const upRes = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${A.token}` }, body: fd });
    const upData = await upRes.json().catch(() => null);
    check('a sealed .enc attachment is accepted by the upload allowlist', upRes.status === 201 || upRes.status === 200, `${upRes.status} ${upData?.message || ''}`);
    const uploaded = upData?.attachments?.[0];
    check('upload returns a url', !!uploaded?.url);

    // The message keeps the ORIGINAL name/mime so the UI still knows it is an
    // image; only the bytes at `url` are ciphertext.
    const textPayload = await e2ee.encryptText(chatKeyA, 'photo attached');
    const send = await http('POST', '/messages', {
      token: A.token,
      body: {
        chatId,
        type: 'image',
        content: '',
        enc: { ...textPayload, v: 1 },
        attachments: [{ url: uploaded.url, name: 'holiday.png', mime: 'image/png', size: PLAIN.length, enc: { iv, v: 1 } }],
      },
    });
    check('a message with a sealed attachment is accepted', send.status === 201, send.data?.message || '');

    const rawMsg = await db.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(send.data.message._id) });
    check('the nonce is persisted on the attachment', rawMsg?.attachments?.[0]?.enc?.iv === iv);
    check('so is the key version it was sealed under', rawMsg?.attachments?.[0]?.enc?.v === 1);
    check('the original filename survives for the UI', rawMsg?.attachments?.[0]?.name === 'holiday.png');
    check('the stored url points at the .enc blob', /\.enc$/.test(rawMsg?.attachments?.[0]?.url || ''));

    // THE point of the whole feature: what is on disk is not the file.
    const onDisk = fs.readFileSync(path.join(SERVER_DIR, uploaded.url.replace(/^\//, '')));
    check('the bytes on disk are NOT the plaintext file', !onDisk.equals(PLAIN));
    check('and are not recoverable by searching them for the content', !onDisk.includes('fake-image-bytes'));

    const reopened = Buffer.from(await e2ee.decryptBytes(chatKeyA, onDisk, iv));
    check('a member holding the chat key decrypts them back to the original', reopened.equals(PLAIN));

    // Tampering must fail closed rather than yield garbage bytes.
    const tampered = Buffer.from(onDisk);
    tampered[tampered.length - 1] ^= 0xff;
    let authFailed = false;
    try {
      await e2ee.decryptBytes(chatKeyA, tampered, iv);
    } catch {
      authFailed = true;
    }
    check('a tampered attachment fails its GCM auth check', authFailed);

    // The server must not invent an `enc` it wasn't given, or a plaintext
    // attachment would be presented to the client as sealed and never render.
    const bad = await http('POST', '/messages', {
      token: A.token,
      body: {
        chatId,
        type: 'image',
        content: '',
        enc: { ...(await e2ee.encryptText(chatKeyA, 'malformed enc')), v: 1 },
        attachments: [{ url: uploaded.url, name: 'x.png', mime: 'image/png', size: 10, enc: { iv: '', v: 0 } }],
      },
    });
    const badRaw = bad.data?.message?._id
      ? await db.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(bad.data.message._id) })
      : null;
    check('a malformed attachment envelope is dropped, not stored', !badRaw?.attachments?.[0]?.enc?.iv);
  }

  section('E2EE — turning it off');
  {
    const { status, data } = await http('POST', `/e2ee/chats/${chatId}/disable`, { token: A.token });
    check('disable succeeds', status === 200 && data.e2ee.enabled === false);
    const after = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'readable again' } });
    check('plaintext is accepted once more', after.status === 201);
    const raw = await db.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(sealedId) });
    check('previously sealed message stays sealed', raw.encrypted === true && !!raw.enc?.ct);
  }

  /* ── 5. Per-chat wallpaper ────────────────────────────────────── */
  section('Chat wallpaper');
  {
    const { status } = await http('PUT', `/users/me/chats/${chatId}/theme`, { token: A.token, body: { wallpaper: 'aurora' } });
    check('setting a wallpaper succeeds', status === 200);

    const { data } = await http('GET', '/chats', { token: A.token });
    const mine = data.chats.find((c) => String(c._id) === String(chatId));
    check('wallpaper comes back on the chat row', mine?.wallpaper === 'aurora');
    check('chat rows do not ship the key material', mine?.e2ee?.keys === undefined);

    const { data: bData } = await http('GET', '/chats', { token: B.token });
    const theirs = bData.chats.find((c) => String(c._id) === String(chatId));
    check('the other participant is unaffected', !theirs?.wallpaper);

    const bad = await http('PUT', `/users/me/chats/${chatId}/theme`, {
      token: A.token,
      body: { wallpaper: 'url(javascript:alert(1))' },
    });
    check('CSS injection via wallpaper id is rejected', bad.status === 400);

    const outsider = await http('PUT', `/users/me/chats/${chatId}/theme`, { token: C.token, body: { wallpaper: 'mint' } });
    check('cannot theme a chat you are not in', outsider.status === 403);

    await http('PUT', `/users/me/chats/${chatId}/theme`, { token: A.token, body: { wallpaper: '' } });
    const { data: cleared } = await http('GET', '/chats', { token: A.token });
    check('clearing removes the override', !cleared.chats.find((c) => String(c._id) === String(chatId))?.wallpaper);

    const settings = await http('PATCH', '/users/me/settings', { token: A.token, body: { wallpaper: 'dots' } });
    check('account-wide default wallpaper saves', settings.status === 200 && settings.data.settings.wallpaper === 'dots');
    const badDefault = await http('PATCH', '/users/me/settings', { token: A.token, body: { wallpaper: '</style><script>' } });
    check('invalid default wallpaper is rejected', badDefault.status === 400);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed}/${results.length} checks passed`);
  for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ ${r.name}`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nFATAL:', err);
  await finish(1);
});

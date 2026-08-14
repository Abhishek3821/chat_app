/**
 * End-to-end tests for the features added on top of the audit findings:
 *   1. global search (people / chats / messages / meetings)
 *   2. starred messages (real list + pagination, not a count)
 *   3. in-chat search over the WHOLE history + jump-to-message context
  *   4. per-chat wallpaper persistence
 *
 * Runs the REAL server against an isolated database.
 *
 * Run:  node tests/search-wallpaper.mjs   (from /server)
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

const PORT = 5103;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run tests.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_feat$2');
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

/** Everything a test user needs. */
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

  /* ── 5. Per-chat wallpaper ────────────────────────────────────── */
  section('Chat wallpaper');
  {
    const { status } = await http('PUT', `/users/me/chats/${chatId}/theme`, { token: A.token, body: { wallpaper: 'aurora' } });
    check('setting a wallpaper succeeds', status === 200);

    const { data } = await http('GET', '/chats', { token: A.token });
    const mine = data.chats.find((c) => String(c._id) === String(chatId));
    check('wallpaper comes back on the chat row', mine?.wallpaper === 'aurora');

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

/**
 * Status (stories) in REAL TIME — does a posted status, and a view of it, reach
 * the other side without a refresh?
 *
 * Written for a reported bug: A posts a status and B doesn't see it until B
 * reloads; and A's view count / viewer list only moves on reload too.
 *
 * The bar here is deliberately "what the other browser receives over the
 * socket", not "what the REST endpoint returns" — every one of these paths
 * already worked on refresh, so a REST-only assertion would pass while the
 * actual complaint went untouched.
 *
 * Run:  node tests/status-realtime.mjs   (from /server)
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

const PORT = 5119;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_status$2');
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

const sockets = [];
async function finish(code) {
  sockets.forEach((s) => s.close());
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
  const phone = `+1555${String(8_200_000 + phoneSeq++).slice(0, 7)}`;
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

async function befriend(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no contact request ${a.name} -> ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}

function connect(token) {
  const s = ioClient(BASE, { auth: (cb) => cb({ token }), transports: ['websocket'], reconnection: false, timeout: 8000 });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

/** Resolve with the first payload of `event`, or null after `ms`. */
function waitFor(socket, event, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, ms);
    function onEvent(payload) {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload ?? {});
    }
    socket.on(event, onEvent);
  });
}

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

  const A = await makeUser('astat');
  const B = await makeUser('bstat');
  const C = await makeUser('cstat'); // a contact of A who is NOT allowed to see the "except" status
  await befriend(A, B);
  await befriend(A, C);

  const sa = await connect(A.token);
  const sb = await connect(B.token);
  const sc = await connect(C.token);
  await sleep(300); // let the personal rooms settle

  /* ── The reported bug: posting ──────────────────────────────────── */
  section('A posts a status — B must be told without refreshing');
  const bGetsPost = waitFor(sb, 'status-updated');
  const posted = await http('POST', '/status', { token: A.token, body: { type: 'text', content: 'hello world' } });
  const statusId = posted.data?.status?._id;
  check('the status is created', posted.status === 201 && !!statusId, `${posted.status}`);
  const postEvent = await bGetsPost;
  check("B's client is notified live", !!postEvent, 'no status-updated within 4s');
  check('the event names whose feed changed', String(postEvent?.userId) === String(A.id), JSON.stringify(postEvent));
  check(
    'the event says WHICH status, so the client can tell a post from a delete',
    String(postEvent?.statusId) === String(statusId) && !postEvent?.removedId,
    JSON.stringify(postEvent)
  );

  // And the REST feed agrees (this always worked — it's the refresh path).
  const bFeed = await http('GET', '/status', { token: B.token });
  check(
    "B's feed contains it on refresh too",
    (bFeed.data?.feed || []).some((e) => String(e.user?._id) === String(A.id)),
    JSON.stringify((bFeed.data?.feed || []).map((e) => e.user?.name))
  );

  /* ── The reported bug: views ────────────────────────────────────── */
  section('B views it — A must see the view count move without refreshing');
  const aGetsView = waitFor(sa, 'status-viewed');
  const viewed = await http('POST', `/status/${statusId}/view`, { token: B.token });
  check('the view is recorded', viewed.status === 200, `${viewed.status}`);
  const viewEvent = await aGetsView;
  check('the OWNER is notified live', !!viewEvent, 'no status-viewed within 4s');
  check('the event identifies the status', String(viewEvent?.statusId) === String(statusId), JSON.stringify(viewEvent));
  check(
    'and carries the viewer, so the count and the list both update',
    String(viewEvent?.viewer?._id) === String(B.id) && !!viewEvent?.viewer?.name,
    JSON.stringify(viewEvent?.viewer)
  );
  check('the running total comes along', viewEvent?.viewerCount === 1, `viewerCount=${viewEvent?.viewerCount}`);

  section('A second view from the same person must not double-count');
  const aGetsDupe = waitFor(sa, 'status-viewed', 1500);
  await http('POST', `/status/${statusId}/view`, { token: B.token });
  check('no repeat event for a re-view', (await aGetsDupe) === null);
  const viewers = await http('GET', `/status/${statusId}/viewers`, { token: A.token });
  check('the viewer list still holds exactly one', (viewers.data?.viewers || []).length === 1, JSON.stringify(viewers.data?.viewers?.length));

  section('A viewing their OWN status is not a view');
  const aGetsSelf = waitFor(sa, 'status-viewed', 1500);
  await http('POST', `/status/${statusId}/view`, { token: A.token });
  check('no self-view event', (await aGetsSelf) === null);
  const viewers2 = await http('GET', `/status/${statusId}/viewers`, { token: A.token });
  check('the owner is not added to their own viewer list', (viewers2.data?.viewers || []).length === 1, `${viewers2.data?.viewers?.length}`);

  /* ── Privacy must survive the live path ─────────────────────────── */
  section("Live fan-out obeys the status's audience");
  const cGetsExcluded = waitFor(sc, 'status-updated', 2500);
  const bGetsIncluded = waitFor(sb, 'status-updated', 2500);
  const priv = await http('POST', '/status', {
    token: A.token,
    body: { type: 'text', content: 'not for C', privacy: { type: 'except', except: [C.id] } },
  });
  check('the restricted status is created', priv.status === 201, `${priv.status}`);
  check('an included contact is notified', !!(await bGetsIncluded));
  check('an EXCLUDED contact is not notified', (await cGetsExcluded) === null);

  section('Deleting a status tells the audience live');
  const bGetsDelete = waitFor(sb, 'status-updated');
  const del = await http('DELETE', `/status/${statusId}`, { token: A.token });
  check('the status is deleted', del.status === 200, `${del.status}`);
  const delEvent = await bGetsDelete;
  check('B is told live', !!delEvent);
  check('the event says which status went away', String(delEvent?.removedId) === String(statusId), JSON.stringify(delEvent));

  section('Replies still reach the owner live');
  const priv2 = await http('POST', '/status', { token: A.token, body: { type: 'text', content: 'reply to me' } });
  const aGetsReply = waitFor(sa, 'status-reply');
  await http('POST', `/status/${priv2.data?.status?._id}/reply`, { token: B.token, body: { text: 'nice one' } });
  const replyEvent = await aGetsReply;
  check('the owner gets the reply live', !!replyEvent && replyEvent.text === 'nice one', JSON.stringify(replyEvent));

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

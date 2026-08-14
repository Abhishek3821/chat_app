/**
 * Personal QR invite — the server half of `/invite/u/:username`.
 *
 * Reported bug: scanning someone's QR from another phone/account did nothing.
 * The client resolved the username and then went straight to
 * `POST /chats/direct/:id`, which requires the two of you to ALREADY be mutual
 * contacts — the exact opposite of what a personal QR is for. So the code only
 * worked between people who could already message each other.
 *
 * The client now falls back to sending a contact request. That fallback rests
 * on two server behaviours, which is what this suite pins:
 *   1. an exact-username search finds a STRANGER, across workspaces;
 *   2. a contact request to that stranger is accepted;
 * plus the 403 that makes the fallback necessary in the first place, so nobody
 * "simplifies" the client back to a bare openDirectChat.
 *
 * Run:  node tests/qr-invite.mjs   (from /server)
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

const PORT = 5123;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_qr$2');
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

async function http(method, url, { token, body, params } = {}) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`${API}${url}${qs}`, {
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
  const phone = `+1555${String(8_500_000 + phoneSeq++).slice(0, 7)}`;
  const username = `${tag}${stamp}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag.toUpperCase()} Tester`,
      username,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone,
      ...extra,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, username, name: data.user.name };
}

/** What the QR page does first: resolve the scanned username. */
const resolve = async (scanner, username) => {
  const { data } = await http('GET', '/users/search', { token: scanner.token, params: { q: username } });
  const list = data?.users || data?.results || [];
  return list.find((u) => String(u.username).toLowerCase() === String(username).toLowerCase()) || null;
};

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

  // OWNER prints the QR. SCANNER is a stranger on another phone, and lives in a
  // different workspace — the shape that made the old flow fail hardest.
  const OWNER = await makeUser('qrowner', { accountType: 'workspace', workspaceName: 'QR Co' });
  const SCANNER = await makeUser('qrscanner');
  const FRIEND = await makeUser('qrfriend');

  section('A stranger scans the QR and resolves the username');
  const found = await resolve(SCANNER, OWNER.username);
  check('the exact username resolves across workspaces', String(found?._id) === String(OWNER.id), JSON.stringify(found && found.username));
  check('a wrong username resolves to nothing', (await resolve(SCANNER, `${OWNER.username}zzz`)) === null);

  section('Why the old flow died: chat is gated on being connected ALREADY');
  const direct = await http('POST', `/chats/direct/${OWNER.id}`, { token: SCANNER.token });
  check(
    'opening a 1:1 with a stranger is refused (403)',
    direct.status === 403,
    `${direct.status} ${direct.data?.message}`
  );

  section('The fallback the QR page now uses');
  const req = await http('POST', `/contacts/request/${OWNER.id}`, { token: SCANNER.token });
  check('a contact request to that stranger is accepted', req.status >= 200 && req.status < 300, `${req.status} ${req.data?.message}`);
  const incoming = await http('GET', '/contacts/requests', { token: OWNER.token });
  const pending = (incoming.data?.incoming || []).find((r) => String(r.from?._id) === String(SCANNER.id));
  check('the owner sees it waiting', !!pending, JSON.stringify((incoming.data?.incoming || []).length));

  // Scanning twice must not look like a failure to the person scanning.
  const again = await http('POST', `/contacts/request/${OWNER.id}`, { token: SCANNER.token });
  check(
    'scanning again is not a hard error the UI must surface',
    again.status < 500,
    `${again.status} ${again.data?.message}`
  );

  section('Once accepted, the QR opens the chat directly');
  await http('PATCH', `/contacts/request/${pending?._id}`, { token: OWNER.token, body: { action: 'accept' } });
  const nowDirect = await http('POST', `/chats/direct/${OWNER.id}`, { token: SCANNER.token });
  check('the 1:1 chat now opens', nowDirect.status === 200 && !!nowDirect.data?.chat?._id, `${nowDirect.status} ${nowDirect.data?.message}`);

  section('Edge cases the page has to handle');
  const self = await http('POST', `/chats/direct/${OWNER.id}`, { token: OWNER.token });
  check('scanning your OWN code is refused by the API (the page short-circuits it)', self.status === 400, `${self.status}`);
  const unauth = await http('GET', '/users/search', { params: { q: OWNER.username } });
  check(
    'resolving requires a session — hence the login-then-return flow',
    unauth.status === 401,
    `${unauth.status}`
  );
  const blocked = await http('POST', `/users/me/block/${FRIEND.id}`, { token: OWNER.token });
  check('(setup) owner blocks someone', blocked.status === 200, `${blocked.status}`);
  const blockedReq = await http('POST', `/contacts/request/${OWNER.id}`, { token: FRIEND.token });
  check('a blocked scanner cannot request via the QR', blockedReq.status === 403, `${blockedReq.status} ${blockedReq.data?.message}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

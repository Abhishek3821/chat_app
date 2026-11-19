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

const PORT = 5129;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_bruteforce$2');
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
  const phone = `+1555${String(9_730_000 + phoneSeq++).slice(0, 7)}`;
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

const randIp = () => `${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 250)}`;
async function spoofed(method, url, { token, body } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), 'X-Forwarded-For': randIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  await startServer();

  const V = await makeUser('victim');
  const O = await makeUser('other');
  const users = mongoose.connection.collection('users');
  const vDoc = await users.findOne({ _id: new mongoose.Types.ObjectId(V.id) });
  const oDoc = await users.findOne({ _id: new mongoose.Types.ObjectId(O.id) });

  section('A pending contact request does not leak the other side\'s email');
  await http('POST', `/contacts/request/${V.id}`, { token: O.token });
  const reqs = await http('GET', '/contacts/requests', { token: O.token });
  const out = (reqs.data?.outgoing || []).find((r) => String(r.to?._id) === String(V.id));
  check('the outgoing request is listed', Boolean(out), JSON.stringify(reqs.data?.outgoing?.length));
  check('…without the recipient\'s email', out && out.to.email === undefined, out?.to?.email);
  check('…and without their privacy settings object', out && out.to.privacy === undefined);
  const inc = await http('GET', '/contacts/requests', { token: V.token });
  const inn = (inc.data?.incoming || []).find((r) => String(r.from?._id) === String(O.id));
  check('the incoming side gets no sender email either', inn && inn.from.email === undefined, inn?.from?.email);

  section('Password guessing with a fresh spoofed IP on every request');
  const codes = [];
  for (let i = 0; i < 12; i += 1) {
    const r = await spoofed('POST', '/auth/login', { body: { identifier: vDoc.email, password: `wrong-${i}` } });
    codes.push(r.status);
  }
  check('the first 10 wrong guesses are answered normally (401)', codes.slice(0, 10).every((c) => c === 401), codes.join(','));
  check('guess 11+ is blocked (429) even though every request used a new IP', codes.slice(10).every((c) => c === 429), codes.join(','));
  const sameAcctOtherForm = await spoofed('POST', '/auth/login', { body: { email: `  ${vDoc.email.toUpperCase()} `, password: 'wrong' } });
  check('changing case / whitespace / field name does not reset the bucket', sameAcctOtherForm.status === 429, String(sameAcctOtherForm.status));

  section('Other accounts and correct logins are unaffected');
  const okOther = await spoofed('POST', '/auth/login', { body: { identifier: oDoc.email, password: 'Passw0rd!23' } });
  check('a different account still signs in', okOther.status === 200, `${okOther.status} ${okOther.data?.message}`);
  let okCount = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await spoofed('POST', '/auth/login', { body: { identifier: oDoc.email, password: 'Passw0rd!23' } });
    if (r.status === 200) okCount += 1;
  }
  check('successful logins never count toward the limit (12 in a row OK)', okCount === 12, `${okCount}/12`);

  section('Chat-lock PIN guessing is capped per signed-in user');
  const en = await http('POST', '/auth/two-step/enable', { token: O.token, body: { pin: '4826' } });
  check('O enables a two-step PIN', en.status === 200, `${en.status} ${en.data?.message}`);
  const pinCodes = [];
  for (let i = 0; i < 12; i += 1) {
    const r = await spoofed('POST', '/chats/locked', { token: O.token, body: { pin: String(1000 + i) } });
    pinCodes.push(r.status);
  }
  check('first 10 wrong PINs → 403', pinCodes.slice(0, 10).every((c) => c === 403), pinCodes.join(','));
  check('11th+ wrong PIN → 429 despite spoofed IPs', pinCodes.slice(10).every((c) => c === 429), pinCodes.join(','));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  await finish(1);
});

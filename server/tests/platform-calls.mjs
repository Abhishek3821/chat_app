/**
 * Can a THIRD-PARTY product's users make group audio/video calls through the
 * embedded platform?
 *
 * The platform suite proves provisioning, token exchange and isolation over
 * REST — but a call is almost entirely SOCKET signalling, and that path had no
 * platform coverage at all. So "can a tenant's users call each other" was an
 * assumption, not a fact. This settles it:
 *
 *   · does a minted USER TOKEN authenticate the Socket.IO handshake?
 *   · can a tenant user create a group and ring the whole group?
 *   · does the ring carry the GROUP identity, as it does for first-party users?
 *   · can two tenant users who are NOT contacts signal each other (group
 *     membership is the only thing that could authorise it)?
 *   · does the `calls` feature flag actually gate it?
 *   · can a tenant's user be rung by ANOTHER tenant's user? (must not be)
 *
 * Run:  node tests/platform-calls.mjs   (from /server)
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

const PORT = 5125;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_pcalls$2');
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

async function http(method, url, { token, appId, secret, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appId) {
    headers['X-CC-App-Id'] = appId;
    if (secret) headers.Authorization = `Bearer ${secret}`;
  }
  const res = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
async function makeOwner(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(9_900_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag} Owner`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone,
    },
  });
  if (status !== 201) throw new Error(`signup failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id };
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

/** NULL on timeout — a missing ring is a failure, never a hang. */
const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/** Provision an end user for a tenant and mint their short-lived token. */
async function tenantUser(app, externalId, name) {
  await http('POST', '/v1/platform/users', { appId: app.appId, secret: app.secret, body: { externalId, name } });
  const { data } = await http('POST', '/v1/platform/tokens', {
    appId: app.appId,
    secret: app.secret,
    body: { externalId },
  });
  return { token: data?.token, id: data?.user?.id, name, features: data?.features || [] };
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

  const owner = await makeOwner('acme');

  /* ── The tenant, with calling switched on ───────────────────────── */
  section('A tenant granted calls + groups');
  const createdA = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Acme CRM', features: ['chat', 'groups', 'calls', 'video', 'presence'] },
  });
  check('the app is created', createdA.status === 201, `${createdA.status} ${createdA.data?.message}`);
  const appA = { appId: createdA.data?.app?.appId, secret: createdA.data?.secret };
  check('an app secret is returned once', !!appA.secret);

  const A = await tenantUser(appA, 'crm-a', 'Ada');
  const B = await tenantUser(appA, 'crm-b', 'Bob');
  const C = await tenantUser(appA, 'crm-c', 'Cleo');
  check('three end users are provisioned and hold tokens', !!(A.token && B.token && C.token));
  check('the token response advertises calls + groups', A.features.includes('calls') && A.features.includes('groups'), JSON.stringify(A.features));

  /* ── The question that had no coverage: does the SOCKET accept them? ── */
  section('Socket handshake with a platform USER TOKEN');
  let sa;
  let sb;
  let sc;
  try {
    sa = await connect(A.token);
    sb = await connect(B.token);
    sc = await connect(C.token);
    check('a minted user token authenticates the Socket.IO handshake', true);
  } catch (err) {
    check('a minted user token authenticates the Socket.IO handshake', false, err.message);
    await finish(1);
  }
  check('all three tenant users are connected', !!(sa.connected && sb.connected && sc.connected));

  /* ── Group calling, end to end ──────────────────────────────────── */
  section('Group audio/video call between the tenant’s users');
  const grp = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Acme Support', members: [B.id, C.id] },
  });
  check('a tenant user can create a group', grp.status === 201 || grp.status === 200, `${grp.status} ${grp.data?.message}`);
  const gid = grp.data?.chat?._id;

  const started = await http('POST', '/calls', {
    token: A.token,
    body: { type: 'video', chatId: gid, isGroup: true, participants: [B.id, C.id] },
  });
  check('a group VIDEO call record is created', started.status === 201 || started.status === 200, `${started.status} ${started.data?.message}`);
  const callId = started.data?.call?._id || started.data?.callId;

  const ringB = waitFor(sb, 'call:incoming');
  const ringC = waitFor(sc, 'call:incoming');
  const invite = (to) =>
    sa.emit('call:invite', { to, callId, chatId: gid, type: 'video', caller: { _id: A.id, name: A.name } });
  invite(B.id);
  invite(C.id);

  const atB = await ringB;
  const atC = await ringC;
  check('B rings', !!atB, 'no call:incoming');
  check('C ALSO rings — the whole group', !!atC, 'no call:incoming');
  check('the ring carries the GROUP name, as for first-party users', atB?.group?.name === 'Acme Support', JSON.stringify(atB?.group));
  check('it is flagged as a group call', atB?.isGroup === true);

  /* B and C were never made contacts — group membership is the only thing that
     can be authorising this leg. */
  section('Media signalling between two tenant users who are NOT contacts');
  const offerAtC = waitFor(sc, 'call:offer');
  sb.emit('call:offer', { to: C.id, callId, chatId: gid, offer: { type: 'offer', sdp: 'v=0 tenant-b-to-c' } });
  const gotOffer = await offerAtC;
  check('B→C SDP offer is relayed', !!gotOffer && gotOffer.offer?.sdp === 'v=0 tenant-b-to-c', 'dropped');

  const iceAtB = waitFor(sb, 'call:ice-candidate');
  sc.emit('call:ice-candidate', { to: B.id, callId, chatId: gid, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1 typ host' } });
  check('C→B ICE candidates flow (the media path can form)', !!(await iceAtB), 'dropped');

  /* ── The feature flag must actually gate it ─────────────────────── */
  section('A tenant WITHOUT the calls feature');
  const createdNo = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Chat Only Co', features: ['chat', 'groups'] },
  });
  const appNo = { appId: createdNo.data?.app?.appId, secret: createdNo.data?.secret };
  const N = await tenantUser(appNo, 'no-1', 'Nora');
  const refused = await http('POST', '/calls', { token: N.token, body: { type: 'audio', receiverId: N.id } });
  check('calling is refused when the tenant lacks the `calls` feature', refused.status === 403, `${refused.status}`);
  check('…with an explanation naming the feature', /calls/i.test(refused.data?.message || ''), refused.data?.message);

  /* ── Cross-tenant isolation on the CALL path ────────────────────── */
  section('Isolation: one tenant must not reach another');
  const createdB2 = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Globex', features: ['chat', 'groups', 'calls'] },
  });
  const appB2 = { appId: createdB2.data?.app?.appId, secret: createdB2.data?.secret };
  const G = await tenantUser(appB2, 'gx-1', 'Gil');
  const sg = await connect(G.token);

  const leak = waitFor(sg, 'call:incoming', 2500);
  sa.emit('call:invite', { to: G.id, callId, chatId: gid, type: 'video', caller: { _id: A.id, name: A.name } });
  check("a user of ANOTHER tenant cannot be rung", !(await leak), 'a cross-tenant ring got through');

  [sa, sb, sc, sg].forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(58)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

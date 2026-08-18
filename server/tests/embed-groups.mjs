/**
 * Group chat + group calling on the embed/platform path.
 *
 * A partner reported group support as missing: `POST /groups` "succeeds but only
 * adds the creator", `PATCH /groups/:id` add-participant is "a silent no-op", and
 * `/calls/start` "has no group shape". All three are real observations of a
 * correctly-working server being addressed with the wrong key or the wrong route:
 *
 *   · `createGroup` reads `members` — `participants`/`userIds` default it to `[]`,
 *     so only the creator lands and the response is still 201.
 *   · `PATCH /:id` is `updateGroup`; it assigns ONLY name/description/avatar/
 *     messagingPolicy and ignores any members field. Adding is `POST /:id/members`.
 *   · `/calls/start` is the 1:1 endpoint by design (`receiverId` + mutual
 *     contacts). Group calls are `POST /calls` with `{ chatId, isGroup, participants }`.
 *
 * Each is asserted in BOTH directions — the wrong form reproducing the reported
 * symptom, and the documented form working — so the difference is the payload and
 * not the feature.
 *
 * Run:  node tests/embed-groups.mjs   (from /server)
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

const PORT = 5139;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_embedgrp$2');
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
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
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
      REDIS_URL: '',
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

let seq = 0;
async function makeOwner(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag} Owner`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+1555${String(9_300_000 + seq++).slice(0, 7)}`,
    },
  });
  if (status !== 201) throw new Error(`signup failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id };
}

async function tenantUser(app, externalId, name) {
  await http('POST', '/v1/platform/users', {
    appId: app.appId,
    secret: app.secret,
    body: { externalId, name },
  });
  const { data } = await http('POST', '/v1/platform/tokens', {
    appId: app.appId,
    secret: app.secret,
    body: { externalId },
  });
  return { token: data?.token, id: data?.user?.id, name };
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

const waitFor = (socket, event, ms = 6000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

const countParticipants = (chat) => (chat?.participants || []).length;

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

  section('Tenant with groups + calls granted');
  const owner = await makeOwner('grp');
  const created = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Partner Groups Co', features: ['chat', 'groups', 'calls', 'video', 'presence'] },
  });
  check('the app is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const app = { appId: created.data?.app?.appId, secret: created.data?.secret };

  const A = await tenantUser(app, 'g-a', 'Ada');
  const B = await tenantUser(app, 'g-b', 'Bo');
  const C = await tenantUser(app, 'g-c', 'Cy');
  check('three tenant users provisioned', !!(A.token && B.token && C.token));

  /* ── The reported symptom: only the creator is added ─────────────── */
  section('POST /groups — the key is `members`');
  const wrongKey = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Wrong Key', participants: [B.id, C.id] }, // `participants` is ignored
  });
  check('REPRODUCED: `participants` returns success…', wrongKey.status === 201, `${wrongKey.status}`);
  check(
    '…but the group holds ONLY the creator',
    countParticipants(wrongKey.data?.chat) === 1,
    `${countParticipants(wrongKey.data?.chat)} participant(s)`
  );

  const wrongKey2 = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Wrong Key 2', userIds: [B.id, C.id] },
  });
  check(
    'REPRODUCED: `userIds` behaves identically',
    countParticipants(wrongKey2.data?.chat) === 1,
    `${countParticipants(wrongKey2.data?.chat)} participant(s)`
  );

  const right = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Acme Support', members: [B.id] }, // C is added later, via the right route
  });
  check('with `members`, the invitees ARE added', countParticipants(right.data?.chat) === 2, `${countParticipants(right.data?.chat)} participant(s)`);
  const gid = right.data?.chat?._id;

  /* Worth pinning for a partner: no contact handshake is needed to group
     someone, because `groupAddPermission` defaults to 'everyone'. B and C were
     never made contacts anywhere in this suite. */
  check('no contact request was needed to add a tenant user to a group', countParticipants(right.data?.chat) === 2);
  check('the response reports anyone SKIPPED, with a reason', Array.isArray(right.data?.skipped), JSON.stringify(right.data?.skipped));

  /* ── The reported symptom: PATCH add-participant does nothing ────── */
  section('Adding later — POST /:id/members, not PATCH /:id');
  const viaPatch = await http('PATCH', `/groups/${gid}`, {
    token: A.token,
    body: { members: [C.id] }, // updateGroup assigns name/description/avatar/messagingPolicy only
  });
  check('REPRODUCED: PATCH returns 200…', viaPatch.status === 200, `${viaPatch.status}`);
  check(
    '…and the member count is UNCHANGED (a silent no-op)',
    countParticipants(viaPatch.data?.chat) === 2,
    `${countParticipants(viaPatch.data?.chat)} participant(s)`
  );

  /* Same call, proving PATCH is not broken — it is a rename endpoint. */
  const renamed = await http('PATCH', `/groups/${gid}`, { token: A.token, body: { name: 'Acme Support EU' } });
  check('PATCH /:id DOES work — for name/description/avatar', renamed.data?.chat?.name === 'Acme Support EU', renamed.data?.chat?.name);

  const viaMembers = await http('POST', `/groups/${gid}/members`, {
    token: A.token,
    body: { members: [C.id] },
  });
  check('POST /:id/members adds them', viaMembers.status === 200 || viaMembers.status === 201, `${viaMembers.status} ${viaMembers.data?.message}`);
  check(
    'the group now holds all three',
    countParticipants(viaMembers.data?.chat) === 3,
    `${countParticipants(viaMembers.data?.chat)} participant(s)`
  );

  /* ── The reported symptom: no group shape on /calls/start ────────── */
  section('Group calls — POST /calls, not POST /calls/start');
  const sa = await connect(A.token);
  const sb = await connect(B.token);
  const sc = await connect(C.token);
  check('all three sockets connect', sa.connected && sb.connected && sc.connected);
  await sleep(600);

  const viaStart = await http('POST', '/calls/start', {
    token: A.token,
    body: { chatId: gid, isGroup: true, participants: [B.id, C.id] },
  });
  check(
    'REPRODUCED: /calls/start rejects a group shape (it is the 1:1 endpoint)',
    viaStart.status === 400,
    `${viaStart.status} ${viaStart.data?.message}`
  );
  check('…and says why', /receiverId/i.test(viaStart.data?.message || ''), viaStart.data?.message);

  const ringB = waitFor(sb, 'call:incoming');
  const ringC = waitFor(sc, 'call:incoming');
  const groupCall = await http('POST', '/calls', {
    token: A.token,
    body: { type: 'video', chatId: gid, isGroup: true, participants: [B.id, C.id] },
  });
  check('POST /calls creates a group VIDEO call', groupCall.status === 201 || groupCall.status === 200, `${groupCall.status} ${groupCall.data?.message}`);

  const atB = await ringB;
  const atC = await ringC;
  check('B rings', !!atB, 'no call:incoming');
  check('C rings too — the whole group', !!atC, 'no call:incoming');
  check('the ring is flagged as a group call', atB?.isGroup === true, JSON.stringify(atB?.isGroup));
  check('it carries the chatId so the callee can mesh with everyone', String(atB?.chatId) === String(gid));

  /* Group membership alone authorises the mesh legs — B and C are not contacts. */
  const offerAtC = waitFor(sc, 'call:offer');
  sb.emit('call:offer', {
    to: C.id,
    callId: groupCall.data?.call?._id,
    chatId: gid,
    offer: { type: 'offer', sdp: 'v=0 b-to-c' },
  });
  check('B→C mesh offer relays on group membership alone', !!(await offerAtC), 'dropped');

  [sa, sb, sc].forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(62)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

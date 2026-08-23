/**
 * A meeting must REFUSE the joiner who would break it — not admit everyone and
 * degrade the room for the people already talking.
 *
 * Before this, nothing enforced anything. The client showed an amber banner past
 * six participants, but a banner is not a control: a 20-person meeting let all
 * twenty in and became unusable for everyone, including whoever was mid-sentence.
 *
 * Verified here with MESH_MAX_PARTICIPANTS=3 so the suite needs four sockets
 * rather than ten — the gate is the same at any limit.
 *
 * Also verified: the two deliberate exemptions. A HOST is never locked out of
 * their own meeting, and an SFU-backed deployment has no ceiling at all, so
 * turning LiveKit on must not leave an invisible mesh limit behind.
 *
 * Run:  node tests/meeting-capacity.mjs   (from /server)
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

const MESH_PORT = 5151; // capped deployment
const SFU_PORT = 5152; // same DB, LiveKit configured → no cap
const LIMIT = 3;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_mtgcap$2');
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

const apiFor = (port) => `http://127.0.0.1:${port}/api`;

async function http(method, url, { token, body, port = MESH_PORT } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiFor(port)}${url}`, {
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

const procs = [];
async function startServer(port, extraEnv = {}) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      CLIENT_URL: 'http://localhost:5290',
      REDIS_URL: '',
      MESH_MAX_PARTICIPANTS: String(LIMIT),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error(`[server:${port}]`, s.trim().slice(0, 200));
  });
  procs.push(proc);
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${apiFor(port)}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`Server on ${port} did not start`);
}

async function finish(code) {
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  procs.forEach((p) => p.kill());
  await sleep(250);
  process.exit(code);
}

let seq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag} User`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+1555${String(7_100_000 + seq++).slice(0, 7)}`,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: `${tag} User` };
}

const connect = (token, port = MESH_PORT) =>
  new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket connect timeout')), 12000);
  });

const joinMeeting = (socket, meetingId, ms = 8000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), ms);
    socket.emit('meeting:join', { meetingId }, (ack) => {
      clearTimeout(t);
      resolve(ack || { ok: false, error: 'empty ack' });
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
  await startServer(MESH_PORT);

  section(`A mesh meeting capped at ${LIMIT}`);
  const HOST = await makeUser('host');
  const B = await makeUser('bee');
  const C = await makeUser('cee');
  const D = await makeUser('dee');
  const E = await makeUser('eee');

  const created = await http('POST', '/meetings', {
    token: HOST.token,
    body: {
      title: 'Capped room',
      startAt: new Date(Date.now() + 60_000).toISOString(),
      durationMinutes: 30,
      type: 'video',
      participants: [B.id, C.id, D.id, E.id],
      settings: { askToJoin: false, joinAnytime: true },
    },
  });
  check('the meeting is created', created.status === 201, `${created.status} ${created.data?.message}`);
  const meetingId = created.data?.meeting?._id;

  const sb = await connect(B.token);
  const sc = await connect(C.token);
  const sd = await connect(D.token);
  const se = await connect(E.token);

  check('guest 1 joins', (await joinMeeting(sb, meetingId)).ok === true);
  check('guest 2 joins', (await joinMeeting(sc, meetingId)).ok === true);
  check(`guest 3 joins — the room is now at the limit of ${LIMIT}`, (await joinMeeting(sd, meetingId)).ok === true);

  section('The joiner who would break the room is refused');
  const refused = await joinMeeting(se, meetingId);
  check('guest 4 is REFUSED', refused.ok === false, JSON.stringify(refused).slice(0, 90));
  check('…flagged as full, not a generic error', refused.full === true, JSON.stringify(refused).slice(0, 90));
  check('…and told what the limit is', refused.limit === LIMIT, String(refused.limit));
  check(
    '…with an explanation a user can act on',
    /full|peer-to-peer|meeting server/i.test(refused.error || ''),
    refused.error
  );
  check('it is NOT sent to the waiting room instead', !refused.waiting && !refused.knocking, JSON.stringify(refused));

  section('The HOST is never locked out of their own meeting');
  const sh = await connect(HOST.token);
  const hostJoin = await joinMeeting(sh, meetingId);
  check('the host joins a full room', hostJoin.ok === true, JSON.stringify(hostJoin).slice(0, 90));
  check('…and sees everyone already there', (hostJoin.peers || []).length >= LIMIT, String((hostJoin.peers || []).length));

  section('A seat freeing up lets the next person in');
  /* The host bypasses the gate but still OCCUPIES a seat, so the room is now
     B + C + D + host = 4 against a limit of 3. Freeing one guest leaves it
     exactly at the limit and the next join is still — correctly — refused. */
  sd.close();
  await sleep(900); // let the disconnect propagate out of the room
  const stillFull = await joinMeeting(se, meetingId);
  check(
    'one seat freed is not enough — the host occupies one too',
    stillFull.ok === false && stillFull.full === true,
    JSON.stringify(stillFull).slice(0, 90)
  );

  sc.close();
  await sleep(900);
  const afterLeave = await joinMeeting(se, meetingId);
  check('with room to spare, the previously-refused guest joins', afterLeave.ok === true, JSON.stringify(afterLeave).slice(0, 90));

  [sb, se, sh].forEach((s) => s.close());
  await sleep(400);

  /* ── With an SFU there is no ceiling ─────────────────────────────── */
  section('LiveKit configured → the mesh cap must not apply');
  await startServer(SFU_PORT, {
    LIVEKIT_URL: 'wss://livekit.test.invalid',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret-not-real-0000000000000000',
  });

  const s2 = [];
  for (const u of [B, C, D, E]) {
    // eslint-disable-next-line no-await-in-loop
    s2.push(await connect(u.token, SFU_PORT));
  }
  const acks = [];
  for (const s of s2) {
    // eslint-disable-next-line no-await-in-loop
    acks.push(await joinMeeting(s, meetingId));
  }
  check(
    `all ${s2.length} guests join past the mesh limit of ${LIMIT}`,
    acks.every((a) => a.ok === true),
    JSON.stringify(acks.map((a) => (a.ok ? 'ok' : a.error))).slice(0, 140)
  );
  check('none was refused as full', !acks.some((a) => a.full), JSON.stringify(acks.filter((a) => a.full)));

  s2.forEach((s) => s.close());

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(60)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

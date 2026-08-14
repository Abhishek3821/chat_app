/**
 * Reproduce (or rule out) the reported real-time failures, using a client
 * configured EXACTLY as the browser configures itself.
 *
 * The existing realtime.mjs suite passes, but it connects with test defaults. The
 * three reported symptoms —
 *   · a message only appears after the recipient refreshes,
 *   · a user who is online shows as offline,
 *   · audio/video calls never connect
 * — all have the same possible cause: the browser's socket never actually
 * establishes. So this mirrors the browser's real handshake:
 *   · the same `Origin` header the dev server sends (CORS is enforced on the
 *     handshake, and a rejection here looks exactly like "realtime is broken"),
 *   · `auth` as a CALLBACK returning { token }, not a static object,
 *   · `withCredentials: true`,
 *   · transports ['websocket', 'polling'] in that order.
 *
 * If this passes, the server and the protocol are sound and the fault is in the
 * running browser/dev-server environment rather than the code.
 *
 * Run:  node tests/realtime-browser.mjs   (from /server)
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

const PORT = 5111;
const API = `http://127.0.0.1:${PORT}/api`;
const SOCKET_URL = `http://127.0.0.1:${PORT}`;
/** The origin a browser on the dev server would send. Must match CLIENT_URL. */
const BROWSER_ORIGIN = process.env.CLIENT_URL || 'http://localhost:5290';

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_rtb$2');
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
    headers: {
      'Content-Type': 'application/json',
      // Browsers always send this; the server's CORS layer reads it.
      Origin: BROWSER_ORIGIN,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
      CLIENT_URL: BROWSER_ORIGIN,
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

/** Connect the way the browser does, Origin header included. */
function browserSocket(token) {
  return io(SOCKET_URL, {
    auth: (cb) => cb({ token }), // callback form, as in useSocket.js
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: false,
    extraHeaders: { Origin: BROWSER_ORIGIN },
  });
}

const waitFor = (socket, event, ms = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }));

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(6_000_000 + phoneSeq++).slice(0, 7)}`;
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

  // Mutual contacts (required before a 1:1 chat, and for call signalling).
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  const { data: reqs } = await http('GET', '/contacts/requests', { token: B.token });
  const req = (reqs.incoming || []).find((r) => String(r.from?._id) === String(A.id));
  if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: B.token, body: { action: 'accept' } });

  /* ── 1. Does a browser-shaped handshake even connect? ───────────── */
  section(`Handshake (Origin: ${BROWSER_ORIGIN})`);
  const sa = browserSocket(A.token);
  const connA = await settle(
    new Promise((resolve, reject) => {
      sa.on('connect', resolve);
      sa.on('connect_error', (e) => reject(new Error(e.message)));
      setTimeout(() => reject(new Error('connect timeout')), 12000);
    })
  );
  check("A's browser-shaped socket connects", connA.ok, connA.e?.message);
  if (!connA.ok) {
    console.log('\n  ⇒ The handshake itself fails. Everything real-time depends on this,');
    console.log('    which would explain messages-only-on-refresh, offline presence AND calls.');
    await finish(1);
  }

  // A must receive its presence snapshot right after connecting.
  const snapA = await settle(waitFor(sa, 'presence-snapshot', 6000));
  check('A receives presence-snapshot on connect', snapA.ok, snapA.e?.message);

  /* ── 2. Presence: does B coming online reach A? ─────────────────── */
  section('Presence');
  const bOnline = settle(waitFor(sa, 'user-online', 8000));
  const sb = browserSocket(B.token);
  await settle(
    new Promise((resolve, reject) => {
      sb.on('connect', resolve);
      sb.on('connect_error', (e) => reject(new Error(e.message)));
      setTimeout(() => reject(new Error('connect timeout')), 12000);
    })
  );
  const gotOnline = await bOnline;
  check('A is told B came online (user-online)', gotOnline.ok && String(gotOnline.v?.userId) === String(B.id), gotOnline.e?.message || JSON.stringify(gotOnline.v));

  const { data: chatRes } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = chatRes.chat._id;
  const { data: chatsForA } = await http('GET', '/chats', { token: A.token });
  const row = (chatsForA.chats || []).find((c) => String(c._id) === String(chatId));
  const peer = (row?.participants || []).find((p) => String(p.user?._id) === String(B.id));
  check('the chat list reports the peer as online', peer?.user?.isOnline === true, `isOnline=${peer?.user?.isOnline}`);

  /* ── 3. Live message delivery (the refresh bug) ─────────────────── */
  section('Live message delivery');
  sa.emit('join-chat', chatId);
  sb.emit('join-chat', chatId);
  await sleep(400);

  const inboundAtB = settle(waitFor(sb, 'receive-message', 8000));
  const sent = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'live delivery probe' } });
  check('A sends a message via the API', sent.status === 201, `${sent.status} ${sent.data?.message}`);
  const arrived = await inboundAtB;
  check(
    'B receives it LIVE over the socket (no refresh)',
    arrived.ok && arrived.v?.message?.content === 'live delivery probe',
    arrived.e?.message || JSON.stringify(arrived.v)?.slice(0, 140)
  );
  check('the delivered payload names the right chat', arrived.ok && String(arrived.v?.chatId) === String(chatId));

  // And the reverse direction.
  const inboundAtA = settle(waitFor(sa, 'receive-message', 8000));
  await http('POST', '/messages', { token: B.token, body: { chatId, content: 'reverse probe' } });
  const back = await inboundAtA;
  check('A receives B’s reply live', back.ok && back.v?.message?.content === 'reverse probe', back.e?.message);

  /* ── 4. Typing indicator ────────────────────────────────────────── */
  section('Typing indicator');
  const typing = settle(waitFor(sb, 'typing-start', 6000));
  sa.emit('typing-start', { chatId });
  const gotTyping = await typing;
  check('B sees A start typing', gotTyping.ok && String(gotTyping.v?.chatId) === String(chatId), gotTyping.e?.message);

  const stopped = settle(waitFor(sb, 'typing-stop', 6000));
  sa.emit('typing-stop', { chatId });
  check('B sees A stop typing', (await stopped).ok);

  /* ── 5. Read receipts ───────────────────────────────────────────── */
  section('Read receipts');
  // The server emits read receipts under BOTH names; the client now handles both.
  const readColon = settle(waitFor(sa, 'message:read', 6000));
  const readHyphen = settle(waitFor(sa, 'message-read', 6000));
  sb.emit('message:read', { chatId });
  const rc = await readColon; const rh = await readHyphen;
  check('A is told B read the conversation (either receipt name)', rc.ok || rh.ok, 'colon:'+rc.ok+' hyphen:'+rh.ok);

  /* ── 6. WebRTC call signalling ──────────────────────────────────── */
  section('WebRTC signalling (audio / video call setup)');
  const callId = `call_${Date.now()}`;
  const incoming = settle(waitFor(sb, 'call:incoming', 8000));
  sa.emit('call:invite', { to: B.id, callId, type: 'video', chatId, caller: { _id: A.id, name: A.name } });
  const ring = await incoming;
  check('B receives call:incoming (the call rings)', ring.ok && String(ring.v?.callId) === String(callId), ring.e?.message || JSON.stringify(ring.v)?.slice(0, 120));

  const accepted = settle(waitFor(sa, 'call:accepted', 8000));
  sb.emit('call:accept', { to: A.id, callId, chatId });
  check('A is told the call was accepted', (await accepted).ok);

  // The three signals that actually establish the peer connection.
  const offerAtB = settle(waitFor(sb, 'call:offer', 8000));
  sa.emit('call:offer', { to: B.id, callId, chatId, offer: { type: 'offer', sdp: 'v=0 fake-sdp' } });
  const gotOffer = await offerAtB;
  check('SDP offer relays A → B', gotOffer.ok && gotOffer.v?.offer?.sdp === 'v=0 fake-sdp', gotOffer.e?.message);

  const answerAtA = settle(waitFor(sa, 'call:answer', 8000));
  sb.emit('call:answer', { to: A.id, callId, chatId, answer: { type: 'answer', sdp: 'v=0 fake-answer' } });
  const gotAnswer = await answerAtA;
  check('SDP answer relays B → A', gotAnswer.ok && gotAnswer.v?.answer?.sdp === 'v=0 fake-answer', gotAnswer.e?.message);

  const iceAtB = settle(waitFor(sb, 'call:ice-candidate', 8000));
  sa.emit('call:ice-candidate', { to: B.id, callId, chatId, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1 typ host' } });
  const gotIce = await iceAtB;
  check('ICE candidates relay A → B', gotIce.ok && !!gotIce.v?.candidate, gotIce.e?.message);

  const ended = settle(waitFor(sb, 'call:ended', 6000));
  sa.emit('call:end', { to: B.id, callId, chatId, duration: 3 });
  check('call:end reaches the peer', (await ended).ok);

  /* ── 7. Does the ICE config the browser would use exist? ────────── */
  section('ICE / TURN configuration');
  const turnVarsSet = ['VITE_TURN_URL', 'VITE_TURN_USERNAME', 'VITE_TURN_CREDENTIAL'].filter((v) => process.env[v]);
  if (turnVarsSet.length === 0) {
    console.log('  ⚠ no VITE_TURN_* credentials configured.');
    console.log('    Signalling above works, so calls will connect on the SAME network (STUN only)');
    console.log('    and fail across NAT/mobile networks. This is configuration, not code.');
  } else {
    check('TURN credentials are configured', turnVarsSet.length === 3, `${turnVarsSet.length}/3 set`);
  }

  sa.close();
  sb.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

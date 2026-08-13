/**
 * Realtime smoke test — Socket.IO transport + WebRTC signaling relay.
 *
 * The other suites exercise REST. Nothing covered the socket layer, which is
 * where "messages don't arrive until I refresh" and "the call rings but never
 * connects" actually live. This drives two real socket clients against a real
 * server and asserts the events land on the other side.
 *
 * Scope note: this verifies SIGNALING (the part this app implements) — the
 * offer/answer/ICE envelopes are relayed to the right peer. It cannot verify
 * media flow, which needs two real browsers and a TURN server.
 *
 * Isolated like every other suite: its own port, its own database, dropped at
 * the end. It never touches the dev/production data.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5133;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env'); process.exit(1); }
// Overridable so the suite can REUSE an existing sandbox database. That matters
// on a shared/free Atlas tier: the cluster caps at 500 collections, and once
// leftover test databases fill it, creating a fresh one fails outright with
// "cannot create a new collection". KEEP_TEST_DB=1 then skips the teardown drop.
const TEST_DB = process.env.REALTIME_TEST_DB || 'chatconnect_t_realtime';
const KEEP_DB = process.env.KEEP_TEST_DB === '1';
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, `/${TEST_DB}$2`);
if (TEST_URI === baseUri) { console.error('Could not derive an isolated test DB.'); process.exit(1); }

const results = [];
let section = '';
const head = (s) => { section = s; console.log(`\n── ${s} ──`); };
function check(name, cond, detail = '') {
  results.push({ section, name, pass: !!cond });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

async function http(method, url, { token, body } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

let proc = null;
async function startServer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT), MONGO_URI: TEST_URI, NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '',
      CLIENT_URL: 'http://localhost:5290', REDIS_URL: '',
      JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(48),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${API}/health`); if (r.ok) return; } catch { /* wait */ }
    await sleep(500);
  }
  throw new Error('Server did not become healthy.');
}

let phoneSeq = 0;
const nextPhone = () => `+1999${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(2, '0')}`;

async function makeUser(tag) {
  const u = {
    name: `RT ${tag}`,
    email: `rt.${tag}.${uniq()}@chatkonect.app`,
    password: 'PasswordR1!',
    phone: nextPhone(),
  };
  const s = await http('POST', '/auth/signup', { body: { ...u, confirmPassword: u.password } });
  if (s.status >= 400) throw new Error(`signup ${tag}: ${s.status} ${JSON.stringify(s.data)}`);
  const l = await http('POST', '/auth/login', { body: { identifier: u.email, password: u.password } });
  if (!l.data?.token) throw new Error(`login ${tag}: ${l.status} ${JSON.stringify(l.data)}`);
  return { ...u, token: l.data.token, id: l.data.user._id };
}

/** Make two users mutual contacts — chatting and ringing are both gated on it. */
async function befriend(A, B) {
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  const reqs = await http('GET', '/contacts/requests', { token: B.token });
  const list = reqs.data?.requests || reqs.data?.incoming || reqs.data || [];
  const r = (Array.isArray(list) ? list : []).find((x) => String(x?.from?._id || x?.from) === String(A.id));
  if (!r) throw new Error(`no incoming contact request for ${B.email}`);
  await http('PATCH', `/contacts/request/${r._id}`, { token: B.token, body: { action: 'accept' } });
}

/** Resolve on the next `event`, or reject when it doesn't arrive in time. */
function waitFor(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for "${event}"`));
    }, ms);
    function onEvent(payload) {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }));

function connect(token) {
  const s = ioClient(BASE, {
    auth: (cb) => cb({ token }),
    transports: ['websocket'],
    reconnection: false,
    timeout: 8000,
  });
  return s;
}

async function main() {
  await startServer();

  const A = await makeUser('alice');
  const B = await makeUser('bob');

  // Chat creation and the call:invite gate both require mutual contacts.
  await befriend(A, B);

  const dc = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const chatId = dc.data?.chat?._id || dc.data?._id;
  if (!chatId) throw new Error(`direct chat: ${dc.status} ${JSON.stringify(dc.data)}`);

  // ── 1. Transport + auth ─────────────────────────────────────────
  head('Socket transport & auth');
  const sa = connect(A.token);
  const sb = connect(B.token);
  const [ca, cb] = await Promise.all([settle(waitFor(sa, 'connect', 8000)), settle(waitFor(sb, 'connect', 8000))]);
  check('client A completes the handshake', ca.ok, ca.e?.message);
  check('client B completes the handshake', cb.ok, cb.e?.message);
  check('negotiated transport is a raw WebSocket (not long-polling)', sa.io?.engine?.transport?.name === 'websocket', sa.io?.engine?.transport?.name);

  const bad = ioClient(BASE, { auth: (cb2) => cb2({ token: 'not-a-real-token' }), transports: ['websocket'], reconnection: false });
  const rejected = await settle(waitFor(bad, 'connect_error', 6000));
  check('a forged token is rejected at the handshake', rejected.ok, 'server accepted an invalid token');
  bad.close();

  // ── 2. Chat realtime ────────────────────────────────────────────
  head('Chat realtime');
  sa.emit('join-chat', chatId);
  sb.emit('join-chat', chatId);
  await sleep(300);

  const inbound = settle(waitFor(sb, 'receive-message', 8000));
  const sent = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'realtime ping' } });
  const got = await inbound;
  check('A sends → B receives `receive-message` live', got.ok && got.v?.message?.content === 'realtime ping', got.e?.message || JSON.stringify(got.v)?.slice(0, 120));
  check('the delivered payload carries the right chat', got.ok && String(got.v?.chatId) === String(chatId), got.e?.message);

  const typing = settle(waitFor(sb, 'typing-start', 4000));
  sa.emit('typing-start', { chatId });
  const t = await typing;
  check('typing-start relays to the peer', t.ok, t.e?.message);

  // Receipts: B acknowledges delivery → A's tick state updates.
  const msgId = sent.data?.message?._id || sent.data?._id;
  const statusEvt = settle(waitFor(sa, 'message:status', 5000));
  sb.emit('message:delivered', { chatId, messageId: msgId });
  const st = await statusEvt;
  check('delivery receipt reaches the sender (`message:status`)', st.ok && st.v?.status === 'delivered', st.e?.message);

  const readEvt = settle(waitFor(sa, 'message:read', 5000));
  sb.emit('message:read', { chatId });
  const rd = await readEvt;
  check('read receipt reaches the sender (`message:read`)', rd.ok, rd.e?.message);

  // ── 2b. Tick state machine, PERSISTED ───────────────────────────
  // The live socket events above prove the ticks update in the moment. This
  // proves the server actually wrote it down — otherwise ticks silently reset
  // to one tick on the next reload, which is the classic version of this bug.
  // `messageStatus()` on the client derives sent/delivered/read purely from
  // deliveredTo + readBy, so those are exactly the fields that must persist.
  head('Tick state machine (persisted)');
  const fetchMsg = async () => {
    const res = await http('GET', `/messages/${chatId}`, { token: A.token });
    const list = res.data?.messages || res.data || [];
    return (Array.isArray(list) ? list : []).find((m) => String(m._id) === String(msgId));
  };
  const persisted = await fetchMsg();
  const deliveredIds = (persisted?.deliveredTo || []).map((u) => String(u?._id ?? u));
  const readerIds = (persisted?.readBy || []).map((r) => String(r.user?._id ?? r.user));
  check('deliveredTo persisted for the recipient', deliveredIds.includes(String(B.id)), JSON.stringify(deliveredIds));
  check('readBy persisted for the recipient', readerIds.includes(String(B.id)), JSON.stringify(readerIds));

  /* Exact copy of client/src/lib/chat.js → messageStatus(), which is what
     actually picks the glyph. Note it only ever inspects the OTHER party's ids:
     the server also lists the sender in deliveredTo/readBy (you have obviously
     seen your own message, and it keeps unread counts correct), and that must
     not be mistaken for the recipient having received it. */
  const derive = (m, peers) => {
    const readers = new Set((m?.readBy || []).map((r) => String(r.user?._id ?? r.user)));
    const delivered = new Set((m?.deliveredTo || []).map((u) => String(u?._id ?? u)));
    if (peers.every((id) => readers.has(id))) return 'read';
    if (peers.some((id) => delivered.has(id) || readers.has(id))) return 'delivered';
    return 'sent';
  };
  const peers = [String(B.id)];

  // Walk a fresh message through all three states in order.
  const fresh = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'tick walk' } });
  const freshId = fresh.data?.message?._id || fresh.data?._id;
  const refetch = async () => {
    const res = await http('GET', `/messages/${chatId}`, { token: A.token });
    const list = res.data?.messages || res.data || [];
    return (Array.isArray(list) ? list : []).find((m) => String(m._id) === String(freshId));
  };
  check('1. just sent, no acks → ONE tick ("sent")', derive(fresh.data?.message || fresh.data, peers) === 'sent', derive(fresh.data?.message || fresh.data, peers));

  sb.emit('message:delivered', { chatId, messageId: freshId });
  await sleep(700);
  const afterDelivered = await refetch();
  check('2. recipient device acked → TWO ticks ("delivered")', derive(afterDelivered, peers) === 'delivered', derive(afterDelivered, peers));

  sb.emit('message:read', { chatId });
  await sleep(700);
  const afterRead = await refetch();
  check('3. recipient opened the chat → BLUE ticks ("read")', derive(afterRead, peers) === 'read', derive(afterRead, peers));

  // ── 3. Presence ─────────────────────────────────────────────────
  head('Presence');
  const offline = settle(waitFor(sa, 'user-offline', 6000));
  sb.close();
  const off = await offline;
  check('peer disconnect broadcasts `user-offline`', off.ok && String(off.v?.userId) === String(B.id), off.e?.message);

  const sb2 = connect(B.token);
  await settle(waitFor(sb2, 'connect', 8000));
  const online = settle(waitFor(sa, 'user-online', 6000));
  const on = await online;
  check('peer reconnect broadcasts `user-online`', on.ok && String(on.v?.userId) === String(B.id), on.e?.message);
  sb2.emit('join-chat', chatId);
  await sleep(200);

  // ── 4. WebRTC signaling relay ───────────────────────────────────
  head('WebRTC signaling relay');
  const callId = new mongoose.Types.ObjectId().toString();

  const ring = settle(waitFor(sb2, 'call:incoming', 6000));
  sa.emit('call:invite', { to: B.id, callId, type: 'video', chatId, caller: { _id: A.id, name: A.name } });
  const r = await ring;
  check('call:invite → callee receives `call:incoming`', r.ok && String(r.v?.from) === String(A.id), r.e?.message);

  const offerEvt = settle(waitFor(sb2, 'call:offer', 6000));
  sa.emit('call:offer', { to: B.id, callId, chatId, offer: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' } });
  const off2 = await offerEvt;
  check('SDP offer relays to the callee', off2.ok && off2.v?.offer?.type === 'offer', off2.e?.message);

  const answerEvt = settle(waitFor(sa, 'call:answer', 6000));
  sb2.emit('call:answer', { to: A.id, callId, chatId, answer: { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' } });
  const ans = await answerEvt;
  check('SDP answer relays back to the caller', ans.ok && ans.v?.answer?.type === 'answer', ans.e?.message);

  const iceEvt = settle(waitFor(sa, 'call:ice-candidate', 6000));
  sb2.emit('call:ice-candidate', { to: A.id, callId, chatId, candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 1 typ host' } });
  const ice = await iceEvt;
  check('ICE candidates relay between peers', ice.ok && !!ice.v?.candidate, ice.e?.message);

  // The dash-form aliases exist so either naming convention works; if one side
  // of the app used them and they silently stopped relaying, calls would break
  // for that path only — worth one assertion.
  const aliasEvt = settle(waitFor(sa, 'webrtc-answer', 6000));
  sb2.emit('webrtc-answer', { to: A.id, callId, chatId, answer: { type: 'answer', sdp: 'v=0\r\n' } });
  const alias = await aliasEvt;
  check('legacy `webrtc-*` aliases still relay', alias.ok, alias.e?.message);

  // A stranger must not be able to ring an arbitrary user.
  const C = await makeUser('mallory');
  const sc = connect(C.token);
  await settle(waitFor(sc, 'connect', 8000));
  const strangerRing = settle(waitFor(sa, 'call:incoming', 2500));
  sc.emit('call:invite', { to: A.id, callId: new mongoose.Types.ObjectId().toString(), type: 'audio' });
  const sr = await strangerRing;
  check('a non-contact CANNOT ring a stranger (signaling gate holds)', !sr.ok, 'stranger reached the callee');

  // ── 5. Meeting attendance report ────────────────────────────────
  // The report only reads `meeting.attendees`; those rows are written by the
  // socket join/leave handlers. So a REST-only test would pass against a
  // completely broken feature — attendance has to be driven through a socket.
  head('Meeting attendance report');
  const mk = await http('POST', '/meetings', {
    token: A.token,
    body: {
      title: 'Attendance check',
      startAt: new Date(Date.now() + 60_000).toISOString(),
      durationMinutes: 30,
      type: 'video',
      participants: [B.id],
    },
  });
  const meetingId = mk.data?.meeting?._id || mk.data?._id;
  check('host can create a meeting', !!meetingId, `${mk.status} ${JSON.stringify(mk.data)?.slice(0, 120)}`);

  if (meetingId) {
    const joined = await new Promise((resolve) => {
      sa.emit('meeting:join', { meetingId }, resolve);
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 6000);
    });
    check('host joins the meeting room over the socket', joined?.ok === true, joined?.error);

    const joinedB = await new Promise((resolve) => {
      sb2.emit('meeting:join', { meetingId }, resolve);
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 6000);
    });
    check('invited guest joins the meeting room', joinedB?.ok === true, joinedB?.error);

    await sleep(1200); // accrue a measurable amount of attendance time
    sb2.emit('meeting:leave', { meetingId });
    await sleep(700); // the leave handler writes leftAt + durationSeconds

    const rep = await http('GET', `/meetings/${meetingId}/report`, { token: A.token });
    const r2 = rep.data?.report;
    check('host can fetch the attendance report', rep.status === 200 && !!r2, `${rep.status}`);
    check('report lists BOTH attendees', (r2?.attendees?.length || 0) >= 2, `got ${r2?.attendees?.length ?? 0}`);
    check('attendeeCount matches the rows', r2?.attendeeCount === (r2?.attendees?.length || 0), `${r2?.attendeeCount}`);
    const guestRow = (r2?.attendees || []).find((a) => a.email === B.email);
    check('the guest row records a joinedAt', !!guestRow?.joinedAt, JSON.stringify(guestRow || {}).slice(0, 120));
    check('leaving stamps leftAt + a non-zero duration', !!guestRow?.leftAt && guestRow?.durationSeconds >= 1, `leftAt=${guestRow?.leftAt} dur=${guestRow?.durationSeconds}`);
    check('meeting was auto-marked started', !!r2?.startedAt, `${r2?.startedAt}`);

    const denied = await http('GET', `/meetings/${meetingId}/report`, { token: B.token });
    check('a non-host CANNOT read the attendance report', denied.status === 403, `${denied.status}`);
  }

  // ── 5b. History pagination (scroll-back) ────────────────────────
  // The server always supported `?before=`, but no client code ever sent it, so
  // conversations past one page had no reachable history. The client now pages
  // on scroll-up; this pins down the contract it relies on.
  head('History pagination');
  const PAGE = 40;
  for (let i = 0; i < PAGE + 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await http('POST', '/messages', { token: A.token, body: { chatId, content: `history ${i}` } });
  }
  const p1 = await http('GET', `/messages/${chatId}?limit=${PAGE}`, { token: A.token });
  const first = p1.data?.messages || [];
  check(`first page returns exactly ${PAGE}`, first.length === PAGE, `${first.length}`);
  check('page is ordered oldest → newest', first.length > 1 && new Date(first[0].createdAt) <= new Date(first[first.length - 1].createdAt), 'ordering is reversed');

  const cursor = new Date(first[0].createdAt).toISOString();
  const p2 = await http('GET', `/messages/${chatId}?limit=${PAGE}&before=${encodeURIComponent(cursor)}`, { token: A.token });
  const older = p2.data?.messages || [];
  check('`before` cursor returns an older page', older.length > 0, `${older.length}`);
  check('older page is also oldest → newest', older.length > 1 && new Date(older[0].createdAt) <= new Date(older[older.length - 1].createdAt), 'ordering is reversed');

  const ids1 = new Set(first.map((m) => String(m._id)));
  check('no overlap between the two pages', older.every((m) => !ids1.has(String(m._id))), 'pages overlap — scroll-back would duplicate rows');
  check('every older message really is older than the cursor', older.every((m) => new Date(m.createdAt) < new Date(cursor)), 'cursor leaked newer messages');
  check('pins ride along on page 1 only (not on paged-back requests)', p2.data?.pins === undefined, 'pins repeated on every page');

  // ── 6. Security: blocking is enforced past discovery ────────────
  // Blocking used to be checked ONLY when searching for people and sending
  // contact requests. Nothing looked at it on the send path or in the call
  // signaling gate, so blocking someone you already had a chat with left them
  // able to message and ring you.
  head('Security · blocking');
  const blockRes = await http('POST', `/users/me/block/${B.id}`, { token: A.token });
  check('A can block B', blockRes.status === 200, `${blockRes.status} ${JSON.stringify(blockRes.data)?.slice(0, 80)}`);

  const blockedSend = await http('POST', '/messages', { token: B.token, body: { chatId, content: 'should be refused' } });
  check('a blocked user CANNOT send into the existing chat', blockedSend.status === 403, `${blockedSend.status}`);
  const blockerSend = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'also refused' } });
  check('the blocker also cannot message the blocked user', blockerSend.status === 403, `${blockerSend.status}`);

  const blockedRing = settle(waitFor(sa, 'call:incoming', 2500));
  sb2.emit('call:invite', { to: A.id, callId: new mongoose.Types.ObjectId().toString(), type: 'audio', chatId });
  const br = await blockedRing;
  check('a blocked user CANNOT ring (signaling gate blocks)', !br.ok, 'the call reached the blocker');

  const unblock = await http('POST', `/users/me/block/${B.id}`, { token: A.token });
  check('unblocking restores messaging', unblock.status === 200, `${unblock.status}`);
  const afterUnblock = await http('POST', '/messages', { token: B.token, body: { chatId, content: 'allowed again' } });
  check('messages flow again after unblock', afterUnblock.status === 201, `${afterUnblock.status}`);

  // ── 7. Security: socket flood protection ────────────────────────
  head('Security · socket rate limit');
  // A legitimate WebRTC burst must survive. 40 ICE candidates back-to-back is
  // well within what a real mesh negotiation produces.
  const legitBurst = settle(waitFor(sa, 'call:ice-candidate', 4000));
  for (let i = 0; i < 40; i += 1) {
    sb2.emit('call:ice-candidate', { to: A.id, callId, chatId, candidate: { candidate: `c${i}` } });
  }
  const lb = await legitBurst;
  check('a realistic 40-candidate ICE burst is NOT throttled', lb.ok, lb.e?.message);

  // A hard loop must get cut off rather than being allowed to saturate the loop.
  const flood = connect(C.token);
  await settle(waitFor(flood, 'connect', 8000));
  const cut = settle(waitFor(flood, 'disconnect', 12000));
  for (let i = 0; i < 3000; i += 1) flood.emit('typing-start', { chatId });
  const fl = await cut;
  check('a 3000-event flood gets the socket disconnected', fl.ok, 'socket survived a flood');
  flood.close();

  sa.close(); sb2.close(); sc.close();

  // ── Summary ─────────────────────────────────────────────────────
  const failed = results.filter((r2) => !r2.pass);
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach((f) => console.log(`  ✗ [${f.section}] ${f.name}`));
  }
  return failed.length;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('\n💥 Suite crashed:', err?.message || err);
  code = 1;
} finally {
  if (!KEEP_DB) {
    try {
      await mongoose.connect(TEST_URI);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    } catch { /* best effort */ }
  }
  if (proc) proc.kill();
}
process.exit(code ? 1 : 0);

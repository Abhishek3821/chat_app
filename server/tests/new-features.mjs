/**
 * Focused checks for the newly-added features:
 *   - self-call blocked by the API
 *   - call:busy relayed to the caller
 *   - call:screen (screen-share presence) relayed
 *   - meeting:presenting broadcast within a meeting room
 *   - two-step PIN: enable → forgot (email OTP) → reset → verify with new PIN
 *
 * Boots the real server against an ISOLATED test database (chatconnect_e2e),
 * with email verification ON and SMTP pointed at nothing (dev OTP surfaces in
 * the API response instead) — signup → verify email → single-step login.
 *
 * Run:  node tests/new-features.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5102;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run tests.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_e2e$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function waitFor(socket, event, { timeout = 5000, filter } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for "${event}"`)); }, timeout);
    function handler(payload) {
      if (filter && !filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 6000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

let serverProc = null;
const socks = [];

async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'true', // signup must verify the email before login works
      // Force "email not configured" (both naming schemes) so dev OTPs come
      // back in API responses instead of being sent.
      EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
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
    try { const res = await fetch(`${API}/health`); if (res.ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

async function cleanupAndExit(code) {
  for (const s of socks) { try { s?.disconnect(); } catch { /* noop */ } }
  try { await mongoose.disconnect(); } catch { /* noop */ }
  if (serverProc && !serverProc.killed) serverProc.kill();
  await sleep(300);
  process.exit(code);
}

async function main() {
  console.log('\nChatConnect new-features check — isolated DB\n');
  if (TEST_URI.includes('+srv')) { try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ } }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();

  await startServer();
  console.log('Server is up. Running tests…\n');

  // ── users: the email must be verified BEFORE signup succeeds ──
  const A = { name: 'Busy A', email: 'busy.a@chatconnect.app', password: 'PasswordA1!', phone: '+15551110001' };
  const B = { name: 'Busy B', email: 'busy.b@chatconnect.app', password: 'PasswordB1!', phone: '+15551110002' };

  // Get the signed email proof the way the Verify button does: send → confirm.
  async function verifyEmailFirst(email) {
    const s = await http('POST', '/auth/email/send-code', { body: { email } });
    const v = await http('POST', '/auth/email/verify-code', { body: { email, otp: s.data?.devOtp } });
    return { send: s, verify: v, token: v.data?.emailToken };
  }

  {
    const noToken = await http('POST', '/auth/signup', { body: { ...A, confirmPassword: A.password } });
    check('signup WITHOUT a verified email is unsuccessful (400)', noToken.status === 400, `status ${noToken.status}: ${noToken.data?.message}`);
  }
  {
    const s = await http('POST', '/auth/email/send-code', { body: { email: A.email } });
    check('Verify button sends a code to the email', s.status === 200 && !!s.data?.devOtp, JSON.stringify(s.data)?.slice(0, 140));
    const bad = await http('POST', '/auth/email/verify-code', { body: { email: A.email, otp: '000000' } });
    check('wrong email code rejected (400)', bad.status === 400, `status ${bad.status}`);
    const good = await http('POST', '/auth/email/verify-code', { body: { email: A.email, otp: s.data?.devOtp } });
    check('correct code → email shows as VERIFIED (proof issued)', good.status === 200 && good.data?.verified === true && !!good.data?.emailToken, JSON.stringify(good.data)?.slice(0, 140));
    A.emailToken = good.data?.emailToken;
  }
  {
    const forged = await http('POST', '/auth/signup', { body: { ...B, confirmPassword: B.password, emailToken: A.emailToken } });
    check("someone ELSE's email proof is rejected (400)", forged.status === 400, `status ${forged.status}`);
  }
  B.emailToken = (await verifyEmailFirst(B.email)).token;

  const sa = await http('POST', '/auth/signup', { body: { ...A, confirmPassword: A.password } });
  const sb = await http('POST', '/auth/signup', { body: { ...B, confirmPassword: B.password } });
  check(
    'signup with a verified email succeeds → session + isVerified',
    sa.status === 201 && !!sa.data?.token && sa.data?.user?.isVerified === true && sb.status === 201,
    JSON.stringify(sa.data)?.slice(0, 140)
  );
  const tokA = sa.data?.token; const tokB = sb.data?.token;
  const idA = sa.data?.user?._id; const idB = sb.data?.user?._id;
  const usernameA = sa.data?.user?.username;

  // ── phone rules at signup ──
  {
    const r = await http('POST', '/auth/signup', {
      body: { name: 'Clone', email: 'clone@chatconnect.app', password: 'PasswordC1!', confirmPassword: 'PasswordC1!', phone: A.phone },
    });
    check('duplicate phone number rejected (409)', r.status === 409, `status ${r.status}: ${r.data?.message}`);
  }
  {
    const r = await http('POST', '/auth/signup', {
      body: { name: 'NoPhone', email: 'nophone@chatconnect.app', password: 'PasswordC1!', confirmPassword: 'PasswordC1!' },
    });
    check('signup without phone rejected (400)', r.status === 400, `status ${r.status}`);
  }
  {
    const r = await http('POST', '/auth/signup', {
      body: { name: 'BadPhone', email: 'badphone@chatconnect.app', password: 'PasswordC1!', confirmPassword: 'PasswordC1!', phone: 'abc123' },
    });
    check('invalid phone rejected (400)', r.status === 400, `status ${r.status}`);
  }

  // ── single-step login: email/username/phone + password → session ──
  {
    const r = await http('POST', '/auth/login', { body: { identifier: usernameA, password: A.password } });
    check('login by USERNAME issues a session directly', r.status === 200 && !!r.data?.token && !r.data?.requiresOtp, JSON.stringify(r.data)?.slice(0, 140));
  }
  {
    const r = await http('POST', '/auth/login', { body: { identifier: '+1 555 111 0002', password: B.password } });
    check('login by PHONE (formatted) issues a session', r.status === 200 && !!r.data?.token, JSON.stringify(r.data)?.slice(0, 140));
  }
  {
    const r = await http('POST', '/auth/login', { body: { identifier: A.email, password: 'WrongPass1!' } });
    check('wrong password still rejected (401)', r.status === 401, `status ${r.status}`);
  }
  {
    const gone = await http('POST', '/auth/login/verify-otp', { body: { identifier: A.email, otp: '123456' } });
    check('removed OTP-login endpoint is gone (404)', gone.status === 404, `status ${gone.status}`);
  }

  // ── search by phone ──
  {
    const r = await http('GET', `/users/search?q=${encodeURIComponent('+1 (555) 111-0002')}`, { token: tokA });
    const hit = (r.data?.users || []).find((u) => String(u._id) === String(idB));
    check('user found by phone number search', !!hit, JSON.stringify(r.data?.users?.map((u) => u.username))?.slice(0, 120));
  }

  // mutual contacts (required for call signaling)
  const reqR = await http('POST', `/contacts/request/${idB}`, { token: tokA });
  const reqId = reqR.data?.request?._id;
  const acc = await http('PATCH', `/contacts/request/${reqId}`, { token: tokB, body: { action: 'accept' } });
  check('A and B are mutual contacts', acc.status === 200, JSON.stringify(acc.data)?.slice(0, 120));

  // ── self-call blocked ──
  {
    const r = await http('POST', '/calls/start', { token: tokA, body: { receiverId: idA, callType: 'video' } });
    check('API blocks calling yourself (400)', r.status === 400, `status ${r.status}`);
  }

  const sockA = await connectSocket(tokA); socks.push(sockA);
  const sockB = await connectSocket(tokB); socks.push(sockB);

  // ── call:busy relay ──
  {
    const started = await http('POST', '/calls/start', { token: tokA, body: { receiverId: idB, callType: 'audio' } });
    const callId = String(started.data?.call?._id || '');
    const busyAtA = waitFor(sockA, 'call:busy');
    const incoming = waitFor(sockB, 'call:incoming');
    sockA.emit('call:invite', { to: idB, callId, type: 'audio', caller: { _id: idA, name: A.name } });
    await incoming;
    sockB.emit('call:busy', { to: idA, callId });
    const busy = await busyAtA;
    check('caller receives call:busy when callee is busy', String(busy?.from) === String(idB) && busy?.callId === callId);
    const hist = await http('GET', '/calls', { token: tokA });
    const rec = (hist.data?.calls || []).find((c) => String(c._id) === callId);
    check('busy call logged as missed in history', rec?.status === 'missed', `status=${rec?.status}`);
  }

  // ── call:screen relay ──
  {
    const started = await http('POST', '/calls/start', { token: tokA, body: { receiverId: idB, callType: 'video' } });
    const callId = String(started.data?.call?._id || '');
    const incoming = waitFor(sockB, 'call:incoming');
    sockA.emit('call:invite', { to: idB, callId, type: 'video', caller: { _id: idA, name: A.name } });
    await incoming;
    const screenAtB = waitFor(sockB, 'call:screen');
    sockA.emit('call:screen', { to: idB, callId, on: true });
    const scr = await screenAtB;
    check('call:screen (presenting) relayed to the peer', String(scr?.from) === String(idA) && scr?.on === true);
    const screenOffAtB = waitFor(sockB, 'call:screen', { filter: (p) => p?.on === false });
    sockA.emit('call:screen', { to: idB, callId, on: false });
    const off = await screenOffAtB;
    check('call:screen off relayed too', off?.on === false);
    sockA.emit('call:cancel', { to: idB, callId });
  }

  // ── meeting:presenting broadcast ──
  {
    const created = await http('POST', '/meetings', { token: tokA, body: { title: 'Present test', type: 'video' } });
    const meetingId = String(created.data?.meeting?._id || '');
    check('meeting created', !!meetingId, JSON.stringify(created.data)?.slice(0, 120));
    const joinAck = (sock) => new Promise((res) => sock.emit('meeting:join', { meetingId }, res));
    const a = await joinAck(sockA);
    const b = await joinAck(sockB);
    check('both joined the meeting room', a?.ok === true && b?.ok === true, JSON.stringify({ a, b }).slice(0, 120));
    const presAtB = waitFor(sockB, 'meeting:presenting');
    sockA.emit('meeting:presenting', { meetingId, on: true });
    const p = await presAtB;
    check('meeting:presenting broadcast to the room', typeof p?.socketId === 'string' && p?.on === true);
    sockA.emit('meeting:leave', { meetingId });
    sockB.emit('meeting:leave', { meetingId });
  }

  // ── two-step PIN: enable → forgot → reset with emailed OTP → verify ──
  {
    const en = await http('POST', '/auth/two-step/enable', { token: tokA, body: { pin: '1234' } });
    check('two-step enable works', en.status === 200 && en.data?.twoStepEnabled === true);
    const forgot = await http('POST', '/auth/two-step/forgot', { token: tokA });
    check('forgot-PIN issues an OTP', forgot.status === 200 && !!forgot.data?.devOtp, JSON.stringify(forgot.data)?.slice(0, 140));
    const otp = forgot.data?.devOtp;
    const bad = await http('POST', '/auth/two-step/reset', { token: tokA, body: { otp: '000000', pin: '5678' } });
    check('wrong OTP rejected', bad.status === 400, `status ${bad.status}`);
    const good = await http('POST', '/auth/two-step/reset', { token: tokA, body: { otp, pin: '5678' } });
    check('reset with correct OTP succeeds', good.status === 200, JSON.stringify(good.data)?.slice(0, 120));
    const oldPin = await http('POST', '/auth/two-step/verify', { token: tokA, body: { pin: '1234' } });
    check('old PIN no longer works', oldPin.status === 400, `status ${oldPin.status}`);
    const newPin = await http('POST', '/auth/two-step/verify', { token: tokA, body: { pin: '5678' } });
    check('new PIN unlocks', newPin.status === 200);

    // change PIN: previous PIN must match before the new one is accepted
    const reEnable = await http('POST', '/auth/two-step/enable', { token: tokA, body: { pin: '9999' } });
    check('enable cannot silently overwrite an existing PIN', reEnable.status === 400, `status ${reEnable.status}`);
    const badChange = await http('POST', '/auth/two-step/change', { token: tokA, body: { currentPin: '0000', newPin: '4321' } });
    check('change PIN with wrong current PIN rejected', badChange.status === 400, `status ${badChange.status}`);
    const samePin = await http('POST', '/auth/two-step/change', { token: tokA, body: { currentPin: '5678', newPin: '5678' } });
    check('change PIN to the same PIN rejected', samePin.status === 400, `status ${samePin.status}`);
    const goodChange = await http('POST', '/auth/two-step/change', { token: tokA, body: { currentPin: '5678', newPin: '4321' } });
    check('change PIN with correct current PIN succeeds', goodChange.status === 200, JSON.stringify(goodChange.data)?.slice(0, 120));
    const oldAfterChange = await http('POST', '/auth/two-step/verify', { token: tokA, body: { pin: '5678' } });
    check('previous PIN stops working after change', oldAfterChange.status === 400, `status ${oldAfterChange.status}`);
    const newAfterChange = await http('POST', '/auth/two-step/verify', { token: tokA, body: { pin: '4321' } });
    check('changed PIN unlocks', newAfterChange.status === 200);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n──────────────────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  await cleanupAndExit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nFATAL:', err?.message || err);
  await cleanupAndExit(1);
});

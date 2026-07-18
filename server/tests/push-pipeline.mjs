/**
 * Device-notification pipeline checks.
 * Verifies that every user-facing event produces a notification through the
 * central notifyUser() helper (in-app record + Web Push attempt):
 *   contact request / accept, 1:1 message, incoming call, missed call, meeting invite.
 * Also verifies /push/key, endpoint allow-listing, and dead-subscription pruning
 * (proof webpush.sendNotification was actually called).
 *
 * Run:  node tests/push-pipeline.mjs   (from /server)
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import webpush from 'web-push';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5103;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_e2e$2');
if (TEST_URI === baseUri) { console.error('Could not derive isolated test DB.'); process.exit(1); }

const vapid = webpush.generateVAPIDKeys();

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
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
      ENABLE_EMAIL_VERIFICATION: 'false',
      ENABLE_LOGIN_OTP: 'false',
      EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '',
      CLIENT_URL: 'http://localhost:5290',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'mailto:test@chatconnect.local',
      REDIS_URL: '', // force inline queue so notifications land synchronously-ish
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 300));
  });
  for (let i = 0; i < 60; i += 1) {
    try { const res = await fetch(`${API}/health`); if (res.ok) return; } catch { /* not up */ }
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
  console.log('\nChatConnect push-pipeline check — isolated DB\n');
  if (TEST_URI.includes('+srv')) { try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ } }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();

  await startServer();
  console.log('Server is up. Running tests…\n');

  // ── users ──
  const A = { name: 'Push A', email: 'push.a@chatconnect.app', password: 'PasswordA1!', phone: '+15552220001' };
  const B = { name: 'Push B', email: 'push.b@chatconnect.app', password: 'PasswordB1!', phone: '+15552220002' };
  for (const u of [A, B]) {
    await http('POST', '/auth/signup', { body: { ...u, confirmPassword: u.password } });
    const r = await http('POST', '/auth/login', { body: { identifier: u.email, password: u.password } });
    u.token = r.data?.token;
    u.id = r.data?.user?._id;
  }
  check('two accounts created + logged in', !!A.token && !!B.token);

  // ── VAPID key exposure ──
  {
    const r = await http('GET', '/push/key', { token: A.token });
    check('push is enabled with the configured VAPID key', r.status === 200 && r.data?.enabled === true && r.data?.publicKey === vapid.publicKey);
  }

  // ── subscription allow-listing ──
  // Real P-256 keypair: web-push must be able to ENCRYPT the payload so the
  // send genuinely reaches the push service (which then 404s the fake token).
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const fakeKeys = { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  {
    const bad = await http('POST', '/push/subscribe', { token: B.token, body: { subscription: { endpoint: 'https://169.254.169.254/steal', keys: fakeKeys } } });
    check('SSRF endpoint rejected', bad.status === 400, `status ${bad.status}`);
    const ok = await http('POST', '/push/subscribe', { token: B.token, body: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/push-pipeline-test-000', keys: fakeKeys } } });
    check('device subscription for B accepted', ok.status === 200 || ok.status === 201, `status ${ok.status}`);
  }

  const notifsOf = async (u) => (await http('GET', '/notifications', { token: u.token })).data?.notifications || [];
  const hasType = (list, type) => list.some((n) => n.type === type);

  // ── contact request → both directions notify ──
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  await sleep(800);
  check('contact request → in-app notification for B', hasType(await notifsOf(B), 'contact_request'));
  {
    const list = await http('GET', '/contacts/requests', { token: B.token });
    const reqId = list.data?.incoming?.[0]?._id;
    await http('PATCH', `/contacts/request/${reqId}`, { token: B.token, body: { action: 'accept' } });
    await sleep(800);
    check('request accepted → notification for A', hasType(await notifsOf(A), 'contact_request'));
  }

  // ── message ──
  {
    const chat = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
    const chatId = chat.data?.chat?._id;
    await http('POST', '/messages', { token: A.token, body: { chatId, content: 'push me', type: 'text' } });
    await sleep(800);
    check('message → notification for B', hasType(await notifsOf(B), 'message'));
  }

  // ── calls: offline → missed; online → incoming ──
  {
    await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'video' } });
    await sleep(800);
    check('call while B offline → missed_call notification', hasType(await notifsOf(B), 'missed_call'));

    socks.push(await connectSocket(B.token));
    await sleep(400);
    await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'audio' } });
    await sleep(800);
    check('call while B online → incoming_call notification', hasType(await notifsOf(B), 'incoming_call'));
  }

  // ── meeting invite ──
  {
    await http('POST', '/meetings', { token: A.token, body: { title: 'Push sync', startAt: new Date(Date.now() + 3600e3).toISOString(), durationMinutes: 30, type: 'video', participants: [B.id] } });
    await sleep(800);
    check('meeting invite → meeting_reminder notification for B', hasType(await notifsOf(B), 'meeting_reminder'));
  }

  // ── the push leg really ran: the dead fake subscription got pruned ──
  {
    await sleep(1500);
    const count = await mongoose.connection.db.collection('pushsubscriptions').countDocuments({});
    check('web-push delivery attempted (dead subscription pruned)', count === 0, `${count} subscription(s) left`);
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

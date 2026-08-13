/**
 * Meeting email invitations. Does scheduling with `inviteEmails` actually produce an invitation?
 * Runs with SMTP unconfigured so sendEmail() logs instead of sending; we read the
 * server's stdout to prove the mail was built and addressed correctly.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5127;
const API = `http://127.0.0.1:${PORT}/api`;
const TEST_URI = (process.env.MONGO_URI || '').replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_invites$2');

const results = [];
const check = (n, c, d = '') => {
  results.push(!!c);
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${c || !d ? '' : `  — ${d}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
let log = '';
async function start() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT), MONGO_URI: TEST_URI, NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      // Force the "not configured" branch so sendEmail logs the invite.
      EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '',
      CLIENT_URL: 'https://chat.example.com', REDIS_URL: '',
      JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(48),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { log += String(d); });
  proc.stderr.on('data', (d) => { log += String(d); });
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${API}/health`); if (r.ok) return; } catch { /* wait */ }
    await sleep(500);
  }
  throw new Error('server did not start');
}

async function signup(tag) {
  const u = {
    name: `Host ${tag}`, email: `inv.${tag}.${Date.now()}@chatkonect.app`,
    password: 'PasswordI1!', phone: `+1555${String(Date.now()).slice(-7)}`,
  };
  await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...u, confirmPassword: u.password }) });
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  const j = await r.json();
  return { token: j.token, user: j.user };
}

async function main() {
  if (TEST_URI.includes('+srv')) { try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ } }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await start();
  const { token } = await signup('h');

  console.log('\nSchedule a meeting with two invite emails:\n');
  const startAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const res = await fetch(`${API}/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Quarterly sync', startAt, durationMinutes: 45, type: 'video',
      timezone: 'Asia/Kolkata',
      inviteEmails: ['guest.one@example.com', 'GUEST.TWO@Example.com', 'not-an-email', 'guest.one@example.com'],
    }),
  });
  const body = await res.json();
  check('meeting created (201)', res.status === 201, `${res.status} ${JSON.stringify(body?.message || '')}`);
  check('response reports invitesQueued = 2 (deduped + validated)', body.invitesQueued === 2, JSON.stringify(body.invitesQueued));
  const m = body.meeting || {};
  check('meeting has a roomCode', !!m.roomCode, JSON.stringify(m.roomCode));
  check('meeting.link is absolute (uses CLIENT_URL)', /^https:\/\/chat\.example\.com\/meet\//.test(m.link || ''), JSON.stringify(m.link));

  await sleep(1200); // invites are fire-and-forget

  check('invite addressed to guest.one', log.includes('guest.one@example.com'));
  check('invite addressed to guest.two (lowercased)', log.includes('guest.two@example.com'));
  check('invalid address was filtered out', !log.includes('not-an-email'));
  const sent = (log.match(/Subject: Invitation: Quarterly sync/g) || []).length;
  check('exactly 2 invitations (deduped)', sent === 2, `saw ${sent}`);
  check('body carries the join link', log.includes(`${m.link}`));
  check('body carries the meeting ID', log.includes(m.roomCode || 'zzz'));
  check('body names the host', /invited you to/.test(log));

  // Instant meetings must NOT silently email anyone.
  const before = (log.match(/Subject: Invitation:/g) || []).length;
  await fetch(`${API}/meetings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'audio' }),
  });
  await sleep(800);
  check('instant meeting sends no invites', (log.match(/Subject: Invitation:/g) || []).length === before);

  // A failed/unsent invite must leave a trace — silently swallowing it was the
  // reason "invite by email" looked broken with no way to diagnose it.
  check('unsent invites are logged loudly', /meeting invite for .* was NOT sent/.test(log));

  const only = await fetch(`${API}/meetings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'No invites', startAt, inviteEmails: [] }),
  });
  check('no addresses → invitesQueued 0', (await only.json()).invitesQueued === 0);

  const junk = await fetch(`${API}/meetings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Junk only', startAt, inviteEmails: ['nope', '@bad', ''] }),
  });
  check('all-invalid addresses → invitesQueued 0', (await junk.json()).invitesQueued === 0);

  if (proc && !proc.killed) proc.kill();
  await mongoose.disconnect();
  const pass = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(50)}\n${pass}/${results.length} checks passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-3000));
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  console.log('\n--- server log ---\n' + log.slice(-3000));
  if (proc && !proc.killed) proc.kill();
  try { await mongoose.disconnect(); } catch { /* noop */ }
  process.exit(1);
});

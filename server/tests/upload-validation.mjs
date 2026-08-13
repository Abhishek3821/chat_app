/**
 * Upload validation errors must be user-facing 4xx, not 500.
 * Regression guard for the multer error mapping in middleware/upload.js.
 * Run: node tests/upload-validation.mjs   (from /server)
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

const PORT = 5119;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_upload$2');

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
async function startServer(prod) {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env, PORT: String(PORT), MONGO_URI: TEST_URI,
      NODE_ENV: prod ? 'production' : 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      EMAIL_HOST: '', EMAIL_USER: '', EMAIL_PASS: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '',
      CLIENT_URL: 'http://localhost:5290', REDIS_URL: '',
      STORAGE_DRIVER: 'local',
      JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(48),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${API}/health`); if (r.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('server did not start');
}
const stopServer = async () => { if (proc && !proc.killed) proc.kill(); await sleep(400); };

async function getToken() {
  const u = { name: 'Up Test', email: `up.${Date.now()}@chatkonect.app`, password: 'PasswordU1!', phone: `+1555${String(Date.now()).slice(-7)}` };
  await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...u, confirmPassword: u.password }) });
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  return (await r.json()).token;
}

async function postFile(token, filename, bytes, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('files', new Blob([bytes], { type }), filename);
  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    let data = null; try { data = await res.json(); } catch { /* noop */ }
    return { status: res.status, data };
  } catch (err) {
    // Rejecting an oversized upload means aborting the request mid-body, and Node
    // resets the connection — so a client still writing the remaining megabytes
    // sees ECONNRESET instead of the 413. That race is inherent to server-side
    // size enforcement (it's exactly why the CLIENT now pre-checks size), so it
    // is reported as its own outcome rather than a spurious failure.
    if (/ECONNRESET|fetch failed|socket hang up/i.test(`${err?.cause?.code || ''} ${err?.message || ''}`)) {
      return { status: 'reset', data: null, reset: true };
    }
    throw err;
  }
}

async function main() {
  if (TEST_URI.includes('+srv')) { try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ } }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });

  console.log('\nUpload validation — development mode\n');
  await startServer(false);
  let token = await getToken();

  const good = await postFile(token, 'ok.png', new Uint8Array(1024), 'image/png');
  check('valid .png upload succeeds (201)', good.status === 201, `got ${good.status}`);
  check('  → returns an attachments array', Array.isArray(good.data?.attachments) && good.data.attachments.length === 1);

  const badType = await postFile(token, 'payload.exe', new Uint8Array(64));
  check('unsupported type → 400 (not 500)', badType.status === 400, `got ${badType.status}`);
  check('  → message names the reason', badType.data?.message === 'Unsupported file type.', JSON.stringify(badType.data?.message));

  const tooBig = await postFile(token, 'huge.png', new Uint8Array(51 * 1024 * 1024), 'image/png');
  check('oversized file → 413 or connection reset, never 500', tooBig.status === 413 || tooBig.reset, `got ${tooBig.status}`);
  check('  → when a response arrives, it states the 50 MB limit',
    tooBig.reset || /under 50 MB/.test(tooBig.data?.message || ''), JSON.stringify(tooBig.data?.message));

  const wrongField = await (async () => {
    const fd = new FormData();
    fd.append('wrongname', new Blob([new Uint8Array(16)], { type: 'image/png' }), 'a.png');
    const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: res.status, data: await res.json().catch(() => null) };
  })();
  check('wrong field name → 400', wrongField.status === 400, `got ${wrongField.status}`);

  const none = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  check('no files → 400', none.status === 400, `got ${none.status}`);

  await stopServer();

  // The real payoff: in production the old bare-Error path became a 500 and the
  // handler swapped the message for a generic string. Prove that no longer happens.
  console.log('\nUpload validation — production mode (message must survive)\n');
  await startServer(true);
  token = await getToken();
  const prodBad = await postFile(token, 'payload.exe', new Uint8Array(64));
  check('prod: unsupported type → 400', prodBad.status === 400, `got ${prodBad.status}`);
  check('prod: real reason still shown (not "Something went wrong")',
    prodBad.data?.message === 'Unsupported file type.', JSON.stringify(prodBad.data?.message));
  const prodBig = await postFile(token, 'huge.png', new Uint8Array(51 * 1024 * 1024), 'image/png');
  check('prod: oversized → 413 with real reason (or a clean reset, never a 500)',
    prodBig.reset || (prodBig.status === 413 && /under 50 MB/.test(prodBig.data?.message || '')),
    `${prodBig.status} ${JSON.stringify(prodBig.data?.message)}`);

  await stopServer();
  await mongoose.disconnect();

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(50)}\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await stopServer(); try { await mongoose.disconnect(); } catch { /* noop */ } process.exit(1); });

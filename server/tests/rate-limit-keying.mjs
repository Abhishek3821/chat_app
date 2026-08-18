/**
 * Rate limits must be PER CLIENT, not one bucket for the whole internet.
 *
 * Written for a production outage: users who had done nothing were shown
 * "Too many requests, please slow down" and could not sign in. Every limiter
 * keyed on `req.ip`, which behind the deployed nginx was the same value for
 * every request — so one 1000-request allowance was shared by everybody.
 *
 * It was measurable from outside: a brand-new IP's very first call to the live
 * API returned `RateLimit-Remaining: 580`, and the counter dropped by 186 in
 * three seconds while that client made exactly one request.
 *
 * A single client can never detect this — its own requests are counted
 * correctly. The only way to catch it is to send from TWO identities and prove
 * the counters are independent, which is what this does.
 *
 * Run:  node tests/rate-limit-keying.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5135;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env — cannot run.'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_ratelimit$2');
if (TEST_URI === baseUri) { console.error('Refusing to run: could not derive an isolated test database name.'); process.exit(1); }

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n— ${t}`);

/** Hit /health as a given client, returning the limiter's own accounting. */
async function ping(headers = {}) {
  const res = await fetch(`${API}/health`, { headers });
  return {
    status: res.status,
    limit: Number(res.headers.get('ratelimit-limit')),
    remaining: Number(res.headers.get('ratelimit-remaining')),
  };
}

let serverProc = null;
async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), MONGO_URI: TEST_URI, NODE_ENV: 'development', ENABLE_EMAIL_VERIFICATION: 'false', CLIENT_URL: 'http://localhost:5290' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 200)); });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

async function finish(code) {
  try { await mongoose.disconnect(); } catch { /* noop */ }
  serverProc?.kill();
  await sleep(200);
  process.exit(code);
}

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await startServer();

  section('Two different clients get two different buckets');
  /* The header a real proxy sets. Without per-client keying BOTH of these are
     `req.ip` = 127.0.0.1 and they share one counter — which is the bug. */
  const alice = { 'X-Forwarded-For': '203.0.113.10' };
  const bob = { 'X-Forwarded-For': '198.51.100.22' };

  const a1 = await ping(alice);
  check('the limiter reports its policy', a1.limit > 0, JSON.stringify(a1));

  // Spend a visible amount as Alice.
  for (let i = 0; i < 15; i += 1) await ping(alice);
  const aliceAfter = await ping(alice);
  const bobFirst = await ping(bob);

  check(
    "Alice's own requests count against Alice",
    aliceAfter.remaining < a1.remaining,
    `${a1.remaining} → ${aliceAfter.remaining}`
  );
  check(
    "Bob is NOT charged for Alice's traffic",
    bobFirst.remaining > aliceAfter.remaining + 10,
    `bob=${bobFirst.remaining} alice=${aliceAfter.remaining} — if these are close, the bucket is shared`
  );
  check(
    "Bob's first request is near the full allowance",
    bobFirst.remaining >= bobFirst.limit - 2,
    `${bobFirst.remaining}/${bobFirst.limit}`
  );

  section('The client address is taken from the proxy headers, in order');
  const cf = await ping({ 'CF-Connecting-IP': '203.0.113.99', 'X-Forwarded-For': '10.0.0.1' });
  const cf2 = await ping({ 'CF-Connecting-IP': '203.0.113.99', 'X-Forwarded-For': '10.0.0.2' });
  check(
    'CF-Connecting-IP wins over X-Forwarded-For (same client, one bucket)',
    cf2.remaining < cf.remaining,
    `${cf.remaining} → ${cf2.remaining}`
  );

  const chained = await ping({ 'X-Forwarded-For': '203.0.113.77, 10.0.0.1, 10.0.0.2' });
  const chained2 = await ping({ 'X-Forwarded-For': '203.0.113.77, 172.16.0.9' });
  check(
    'the LEFTMOST X-Forwarded-For entry is the client, whatever follows it',
    chained2.remaining < chained.remaining,
    `${chained.remaining} → ${chained2.remaining}`
  );

  section('A distinct client is still distinct');
  const fresh = await ping({ 'X-Forwarded-For': '192.0.2.55' });
  check('an unrelated address starts fresh', fresh.remaining >= fresh.limit - 2, `${fresh.remaining}/${fresh.limit}`);

  section('IPv6 is bucketed per /64, not per address');
  /* A single IPv6 subscriber is handed a whole /64. Keying on the exact address
     would let one customer cycle through billions of keys and never be limited. */
  const v6a = await ping({ 'X-Forwarded-For': '2001:db8:abcd:1234::1' });
  const v6b = await ping({ 'X-Forwarded-For': '2001:db8:abcd:1234::9999' });
  check(
    'two addresses in one /64 share a bucket',
    v6b.remaining < v6a.remaining,
    `${v6a.remaining} → ${v6b.remaining}`
  );
  const v6other = await ping({ 'X-Forwarded-For': '2001:db8:abcd:9999::1' });
  check('a different /64 does not', v6other.remaining >= v6other.limit - 2, `${v6other.remaining}/${v6other.limit}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

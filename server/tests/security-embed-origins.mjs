/**
 * A tenant-registered origin must NEVER gain ambient-credential access.
 *
 * Feeding `App.allowedOrigins` into the shared CORS/CSRF allowlist made
 * self-service embedding work — and opened a critical hole, because that list is
 * attacker-controllable:
 *
 *   1. `POST /api/apps` needs only a logged-in user, so ANYONE who can sign up
 *      can create a tenant.
 *   2. `PATCH /api/apps/:id` lets them register any origin, e.g. evil.example.
 *   3. Auth cookies are SameSite=None; Secure in production (frontend and API are
 *      different sites), so they ARE sent cross-site.
 *   4. `protect` accepts `req.cookies.token`, and `POST /auth/refresh` is
 *      authenticated by the refresh cookie alone, ignoring headers entirely.
 *
 * So evil.example could, in the browser of any logged-in ChatKonect user who
 * visited it, mint and READ a fresh access token. Account takeover, reachable by
 * anyone who can sign up.
 *
 * The fix splits origin trust into two tiers: first-party origins may use
 * cookies; tenant origins are Bearer-only and are refused CORS credentials. This
 * proves the attack is dead AND that legitimate tenant traffic still works —
 * a fix that broke the second would just be a different outage.
 *
 * Run:  node tests/security-embed-origins.mjs   (from /server)
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

const PORT = 5147;
const API = `http://127.0.0.1:${PORT}/api`;

const FIRST_PARTY = 'http://localhost:5290'; // = CLIENT_URL below
const EVIL = 'https://evil.example'; // registered by the attacker's tenant
const UNREGISTERED = 'https://nobody.example';

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_secorigin$2');
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

async function http(method, url, { token, body, origin, cookie, rawAuth, appIdHeader } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (appIdHeader) headers['X-CC-App-Id'] = appIdHeader;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (rawAuth) headers.Authorization = rawAuth;
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text, headers: res.headers };
}

let proc = null;
async function startServer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      CLIENT_URL: FIRST_PARTY,
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 200));
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
  proc?.kill();
  await sleep(200);
  process.exit(code);
}

let seq = 0;
async function signup(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const res = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${tag} User`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+1555${String(8_100_000 + seq++).slice(0, 7)}`,
    }),
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`signup ${tag} failed (${res.status}): ${data?.message}`);
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  // What a browser would send back on a later request.
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return { token: data.accessToken || data.token, id: data.user._id, cookie };
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

  /* ── The attacker sets the trap ──────────────────────────────────── */
  section('Anyone who can sign up can register an origin');
  const attacker = await signup('attacker');
  const created = await http('POST', '/apps', {
    token: attacker.token,
    body: { name: 'Totally Legit Co', features: ['chat'] },
  });
  check(
    'a PLAIN user (not an admin) can create a tenant',
    created.status === 201,
    `${created.status} — if this ever becomes admin-only, this check should flip`
  );
  const appId = created.data?.app?.appId;
  const appDocId = created.data?.app?._id;

  const pinned = await http('PATCH', `/apps/${appDocId}`, {
    token: attacker.token,
    body: { allowedOrigins: [EVIL] },
  });
  check('…and register an arbitrary origin on it', pinned.status === 200, `${pinned.status}`);

  /* The origin IS now trusted enough to bootstrap an embed — that part is
     intended, and is what makes self-service integration work. */
  const cfg = await http('GET', `/v1/embed/config?appId=${appId}&parentOrigin=${encodeURIComponent(EVIL)}`);
  check('the origin is accepted for embed bootstrap (intended)', cfg.status === 200, `${cfg.status}`);

  /* ── The victim ──────────────────────────────────────────────────── */
  section('A logged-in first-party victim visits that origin');
  const victim = await signup('victim');
  check('the victim holds session cookies', /token=/.test(victim.cookie), victim.cookie.slice(0, 40));

  /* Sanity: the cookie really is a working ambient credential. */
  const cookieOnly = await http('PATCH', '/users/me/presence', {
    cookie: victim.cookie,
    origin: FIRST_PARTY,
    body: { state: 'available' },
  });
  check(
    'cookies alone DO authenticate from the first-party origin (so the risk is real)',
    cookieOnly.status < 400,
    `${cookieOnly.status} ${cookieOnly.data?.message}`
  );

  /* ── The attack ──────────────────────────────────────────────────── */
  section('The attack: evil.example using the victim’s ambient cookies');
  const refreshAttack = await http('POST', '/auth/refresh', {
    origin: EVIL,
    cookie: victim.cookie,
  });
  check(
    'BLOCKED: /auth/refresh from a tenant origin with the victim’s cookie',
    refreshAttack.status === 403,
    `${refreshAttack.status} ${refreshAttack.data?.message}`
  );
  check(
    '…and no access token is in the response body',
    !/"(accessToken|token)"\s*:\s*"e/.test(refreshAttack.text),
    refreshAttack.text.slice(0, 120)
  );

  const mutateWithCookie = await http('PATCH', '/users/me/presence', {
    origin: EVIL,
    cookie: victim.cookie,
    body: { state: 'available' },
  });
  check(
    'BLOCKED: a state change from a tenant origin on cookies alone',
    mutateWithCookie.status === 403,
    `${mutateWithCookie.status} ${mutateWithCookie.data?.message}`
  );

  /* A garbage Bearer must not be a bypass: without the cookie check, this would
     satisfy "has a Bearer" and then /auth/refresh would ignore the header and use
     the cookie anyway. */
  const garbageBearer = await http('POST', '/auth/refresh', {
    origin: EVIL,
    cookie: victim.cookie,
    rawAuth: 'Bearer not-a-real-token',
  });
  check(
    'BLOCKED: a junk Bearer alongside the cookie is not a bypass',
    garbageBearer.status === 403,
    `${garbageBearer.status} ${garbageBearer.data?.message}`
  );

  const unregistered = await http('PATCH', '/users/me/presence', {
    origin: UNREGISTERED,
    cookie: victim.cookie,
    body: { state: 'available' },
  });
  check('BLOCKED: an entirely unregistered origin', unregistered.status === 403, `${unregistered.status}`);

  /* ── The fix must not break the legitimate case ──────────────────── */
  section('Legitimate tenant traffic still works (Bearer, no cookies)');
  const tokenRes = await http('POST', '/v1/platform/users', {
    body: { externalId: 'legit-1', name: 'Legit User' },
    rawAuth: `Bearer ${created.data?.secret}`,
    appIdHeader: appId,
  });
  const provisioned = tokenRes.status === 201 || tokenRes.status === 200;
  const minted = await fetch(`${API}/v1/platform/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CC-App-Id': appId,
      Authorization: `Bearer ${created.data?.secret}`,
    },
    body: JSON.stringify({ externalId: 'legit-1' }),
  });
  const mintedBody = await minted.json();
  check('a tenant user provisions and mints', provisioned && !!mintedBody?.token, `${tokenRes.status}/${minted.status}`);

  const legit = await http('PATCH', '/users/me/presence', {
    origin: EVIL, // the tenant's own registered origin
    token: mintedBody?.token, // a real Bearer user token
    body: { state: 'available' },
  });
  check(
    'ALLOWED: Bearer user token from the registered origin, no cookies',
    legit.status < 400,
    `${legit.status} ${legit.data?.message}`
  );

  /* ── CORS credentials must differ by tier ────────────────────────── */
  section('CORS: credentials only for first-party origins');
  const fpCors = await http('GET', '/health', { origin: FIRST_PARTY });
  check(
    'first-party origin gets Access-Control-Allow-Credentials',
    fpCors.headers.get('access-control-allow-credentials') === 'true',
    String(fpCors.headers.get('access-control-allow-credentials'))
  );
  check(
    '…and is echoed as an allowed origin',
    !!fpCors.headers.get('access-control-allow-origin'),
    String(fpCors.headers.get('access-control-allow-origin'))
  );

  const tenantCors = await http('GET', '/health', { origin: EVIL });
  check(
    'a tenant origin is allowed for CORS (its frontend must work)',
    !!tenantCors.headers.get('access-control-allow-origin'),
    String(tenantCors.headers.get('access-control-allow-origin'))
  );
  check(
    'CRITICAL: but is NOT granted credentials',
    !tenantCors.headers.get('access-control-allow-credentials'),
    `got ${tenantCors.headers.get('access-control-allow-credentials')} — the browser would send cookies`
  );

  const noCors = await http('GET', '/health', { origin: UNREGISTERED });
  check(
    'an unregistered origin gets no CORS headers at all',
    !noCors.headers.get('access-control-allow-origin'),
    String(noCors.headers.get('access-control-allow-origin'))
  );

  /* ── The allowlist must only accept actual origins ───────────────── */
  section('Registration rejects values that are not origins');
  for (const bad of ['null', '*', 'javascript:alert(1)', 'not a url', 'ftp://x.example']) {
    const r = await http('PATCH', `/apps/${appDocId}`, {
      token: attacker.token,
      body: { allowedOrigins: [bad] },
    });
    check(`non-origins are rejected: ${JSON.stringify(bad)}`, r.status === 400, `${r.status} ${r.data?.message}`);
  }

  /* A path or trailing slash must normalise, not silently fail to match. */
  const norm = await http('PATCH', `/apps/${appDocId}`, {
    token: attacker.token,
    body: { allowedOrigins: ['https://app.example.com/some/path', 'https://app.example.com/'] },
  });
  check('a URL with a path normalises to its origin', norm.status === 200 && JSON.stringify(norm.data?.app?.allowedOrigins) === JSON.stringify(['https://app.example.com']), JSON.stringify(norm.data?.app?.allowedOrigins));
  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(62)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

/**
 * The drop-in embed: everything a host product needs so it configures NOTHING.
 *
 * The premise being tested is that a partner supplies one user token and gets a
 * working product — no API base, no socket URL, no TURN relay, no rebuilt UI.
 * Each of those was previously the integrator's problem and each produced a
 * silent failure when guessed wrong.
 *
 * Covers:
 *   · GET /v1/embed/config — public (app id only), reports API + socket + embed
 *     URLs and the tenant's capabilities
 *   · App.allowedOrigins actually ENFORCED (it was stored and never read), and
 *     checked against the PARENT origin, not the iframe's own
 *   · GET /v1/embed/ice — authenticated, mints time-limited coturn credentials
 *     whose HMAC verifies and whose expiry is in the future
 *   · a tenant's registered origin is now accepted by CORS/CSRF without an
 *     operator editing EXTRA_CORS_ORIGINS and redeploying
 *
 * Run:  node tests/embed-dropin.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5141;
const API = `http://127.0.0.1:${PORT}/api`;

/* A throwaway relay config so credential minting can be verified end to end.
   Not a real relay — nothing dials it; only the signature and expiry are checked. */
const TEST_TURN_URL = 'turn:turn.test.invalid:3478?transport=udp';
const TEST_TURN_SECRET = 'test-static-auth-secret-do-not-use';

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_embeddrop$2');
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

async function http(method, url, { token, appId, secret, body, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appId) {
    headers['X-CC-App-Id'] = appId;
    if (secret) headers.Authorization = `Bearer ${secret}`;
  }
  if (origin) headers.Origin = origin;
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
  return { status: res.status, data, headers: res.headers };
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
      EMBED_URL: 'https://chat.example.com',
      TURN_URL: TEST_TURN_URL,
      TURN_SECRET: TEST_TURN_SECRET,
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
      phone: `+1555${String(9_100_000 + seq++).slice(0, 7)}`,
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
  return { token: data?.token, id: data?.user?.id };
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

  const owner = await makeOwner('emb');

  /* ── Bootstrap: one public call, everything resolved ─────────────── */
  section('GET /v1/embed/config — the host configures nothing');
  const created = await http('POST', '/apps', {
    token: owner.token,
    body: { name: 'Drop-in Co', features: ['chat', 'groups', 'calls', 'video', 'presence', 'meetings'] },
  });
  check('the app is created', created.status === 201, `${created.status}`);
  const app = { appId: created.data?.app?.appId, secret: created.data?.secret, id: created.data?.app?._id };

  const cfg = await http('GET', `/v1/embed/config?appId=${app.appId}`);
  check('config is readable with the app id ALONE (no secret)', cfg.status === 200, `${cfg.status} ${cfg.data?.message}`);
  check('it names the tenant', cfg.data?.app?.appId === app.appId);
  check('it reports the granted capabilities', (cfg.data?.app?.features || []).includes('calls'), JSON.stringify(cfg.data?.app?.features));
  check('it resolves the API base', /\/api$/.test(cfg.data?.endpoints?.apiBaseUrl || ''), cfg.data?.endpoints?.apiBaseUrl);
  check('it resolves the socket URL', !!cfg.data?.endpoints?.socketUrl, cfg.data?.endpoints?.socketUrl);
  check(
    'it resolves the iframe URL from EMBED_URL',
    cfg.data?.endpoints?.embedUrl === 'https://chat.example.com/embed',
    cfg.data?.endpoints?.embedUrl
  );
  check('it reports relay availability', cfg.data?.ice?.relay === 'configured', JSON.stringify(cfg.data?.ice));
  check('it does NOT leak relay credentials on this public endpoint', !JSON.stringify(cfg.data).includes(TEST_TURN_SECRET));
  check('the token lifetime is reported so the host can pre-empt expiry', Number(cfg.data?.userTokenSeconds) > 0, String(cfg.data?.userTokenSeconds));

  const unknown = await http('GET', '/v1/embed/config?appId=app_does_not_exist');
  check('an unknown app id is refused', unknown.status === 404, `${unknown.status}`);
  const noId = await http('GET', '/v1/embed/config');
  check('a missing app id is refused', noId.status === 400, `${noId.status}`);

  /* ── allowedOrigins: stored-but-never-read, now enforced ─────────── */
  section('App.allowedOrigins is ENFORCED, against the PARENT origin');
  const PARTNER = 'https://app.partner.example';
  const pinned = await http('PATCH', `/apps/${app.id}`, {
    token: owner.token,
    body: { allowedOrigins: [PARTNER] },
  });
  check('origins can be pinned on the app', pinned.status === 200, `${pinned.status} ${pinned.data?.message}`);

  const okOrigin = await http('GET', `/v1/embed/config?appId=${app.appId}&parentOrigin=${encodeURIComponent(PARTNER)}`);
  check('the registered parent origin is accepted', okOrigin.status === 200, `${okOrigin.status} ${okOrigin.data?.message}`);

  const badOrigin = await http(
    'GET',
    `/v1/embed/config?appId=${app.appId}&parentOrigin=${encodeURIComponent('https://evil.example')}`
  );
  check('an UNREGISTERED parent origin is refused', badOrigin.status === 403, `${badOrigin.status}`);
  check('…and the message says what to do', /allowed origins/i.test(badOrigin.data?.message || ''), badOrigin.data?.message);

  /* The check must not be satisfied by our own origin: the iframe's XHR carries
     the ChatKonect origin, so a naive Origin-header check could never fail. */
  const selfOriginOnly = await http('GET', `/v1/embed/config?appId=${app.appId}`, {
    origin: 'http://localhost:5290',
  });
  check(
    'a call with only OUR origin and no parentOrigin is refused once pinned',
    selfOriginOnly.status === 403,
    `${selfOriginOnly.status} — a header-only check would have passed here`
  );

  /* ── Relay credentials: minted, signed, expiring ─────────────────── */
  section('GET /v1/embed/ice — minted TURN credentials');
  const anon = await http('GET', '/v1/embed/ice');
  check('relay credentials require authentication', anon.status === 401, `${anon.status}`);

  const U = await tenantUser(app, 'emb-u1', 'Embed User');
  const ice = await http('GET', '/v1/embed/ice', { token: U.token });
  check('an authenticated end user receives ICE servers', ice.status === 200, `${ice.status} ${ice.data?.message}`);

  const servers = ice.data?.iceServers || [];
  const turn = servers.find((s) => JSON.stringify(s.urls || '').includes('turn:'));
  check('a TURN entry is present', !!turn, JSON.stringify(servers));
  check('a STUN entry is present too (cheaper path tried first)', servers.some((s) => JSON.stringify(s.urls || '').includes('stun:')));

  const [expiryStr] = String(turn?.username || '').split(':');
  const expiry = Number(expiryStr);
  check('the username carries a UNIX expiry', Number.isFinite(expiry) && expiry > 0, turn?.username);
  check('the expiry is in the future', expiry * 1000 > Date.now(), new Date(expiry * 1000).toISOString());
  check('…and is bounded (not effectively permanent)', expiry * 1000 - Date.now() <= 24 * 3600 * 1000 + 5000);

  const expectHmac = crypto.createHmac('sha1', TEST_TURN_SECRET).update(String(turn?.username)).digest('base64');
  check('the credential is a valid HMAC of the username (coturn REST scheme)', turn?.credential === expectHmac, 'signature mismatch');
  check('the static secret itself is never sent', !JSON.stringify(ice.data).includes(TEST_TURN_SECRET));

  /* ── One relay config must serve the APP as well as embeds ───────── */
  section('GET /v1/ice — one relay config serves BOTH surfaces');
  /* Server-side minting was originally reachable only at /v1/embed/ice, and the
     first-party client read nothing but build-time VITE_TURN_* — so setting
     TURN_URL fixed embeds while leaving the actual app STUN-only. Two places to
     configure, and the one that was missed failed silently. */
  const fpIce = await http('GET', '/v1/ice', { token: owner.token });
  check('a FIRST-PARTY user can fetch minted ICE servers', fpIce.status === 200, `${fpIce.status} ${fpIce.data?.message}`);
  const fpTurn = (fpIce.data?.iceServers || []).find((x) => JSON.stringify(x.urls || '').includes('turn:'));
  check('…and gets the operator relay, not just STUN', !!fpTurn, JSON.stringify(fpIce.data?.iceServers));
  const fpExpiry = Number(String(fpTurn?.username || '').split(':')[0]);
  check('the credential is time-limited', Number.isFinite(fpExpiry) && fpExpiry * 1000 > Date.now(), String(fpTurn?.username));
  const fpHmac = crypto.createHmac('sha1', TEST_TURN_SECRET).update(String(fpTurn?.username)).digest('base64');
  check('its HMAC verifies against the operator secret', fpTurn?.credential === fpHmac, 'signature mismatch');
  check('the static secret is never sent', !JSON.stringify(fpIce.data).includes(TEST_TURN_SECRET));

  const anonIce = await http('GET', '/v1/ice');
  check('it still requires authentication (relay bandwidth is billable)', anonIce.status === 401, `${anonIce.status}`);
  /* ── The CORS gap that made self-service embedding impossible ────── */
  section("A tenant's registered origin is accepted by CORS/CSRF");
  /* Previously this required an operator to add the origin to the global
     EXTRA_CORS_ORIGINS and redeploy — per partner. A state-changing request is
     used because that is what csrfGuard actually blocks. */
  const mutate = await http('POST', '/users/me/presence', {
    token: U.token,
    origin: PARTNER,
    body: { state: 'online' },
  });
  check(
    'a mutation from the registered origin is not blocked as cross-site',
    mutate.status !== 403 || !/cross-site/i.test(mutate.data?.message || ''),
    `${mutate.status} ${mutate.data?.message}`
  );

  const rogue = await http('POST', '/users/me/presence', {
    token: U.token,
    origin: 'https://not-registered.example',
    body: { state: 'online' },
  });
  check(
    'a mutation from an unregistered origin IS still blocked',
    rogue.status === 403 && /cross-site/i.test(rogue.data?.message || ''),
    `${rogue.status} ${rogue.data?.message}`
  );

  /* ── A disabled tenant cannot embed at all ───────────────────────── */
  section('Disabling the app stops the embed');
  await http('PATCH', `/apps/${app.id}`, { token: owner.token, body: { active: false } });
  const dead = await http('GET', `/v1/embed/config?appId=${app.appId}&parentOrigin=${encodeURIComponent(PARTNER)}`);
  check('a disabled app cannot bootstrap an embed', dead.status === 403, `${dead.status} ${dead.data?.message}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(62)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

/**
 * Runs `examples/saas-host/` for real, against a real API.
 *
 * The example is the first thing anyone integrating will copy, so it rotting
 * silently is expensive: a stale field name or a changed platform response shape
 * would leave the copy-paste path broken while every other suite stayed green.
 *
 * This starts the API, creates a tenant, boots the example host with those
 * credentials, and then checks the two things the host actually does:
 *
 *   · GET /chat-token mints a token that is a REAL session (it authenticates
 *     against /auth/me) and does NOT leak the app secret
 *   · GET / serves a page wired to the right embed origin and app id
 *
 * Run:  node tests/embed-host-example.mjs   (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(SERVER_DIR, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const API_PORT = 5143;
const HOST_PORT = 4399;
const API = `http://127.0.0.1:${API_PORT}/api`;
const HOST = `http://127.0.0.1:${HOST_PORT}`;
const CK_HOST = 'http://127.0.0.1:5290';

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_embedhost$2');
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

async function http(method, url, { token, body, base = API, appHeaders } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appHeaders) {
    headers['X-CC-App-Id'] = appHeaders.appId;
    headers.Authorization = `Bearer ${appHeaders.secret}`;
  }
  const res = await fetch(`${base}${url}`, {
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
  return { status: res.status, data, text };
}

const procs = [];
function track(p, label) {
  p.stdout?.on('data', () => {});
  p.stderr?.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error(`[${label}]`, s.trim().slice(0, 200));
  });
  procs.push(p);
  return p;
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
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

  /* ── The API ─────────────────────────────────────────────────────── */
  track(
    spawn(process.execPath, ['server.js'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        MONGO_URI: TEST_URI,
        NODE_ENV: 'development',
        ENABLE_EMAIL_VERIFICATION: 'false',
        CLIENT_URL: CK_HOST,
        EMBED_URL: CK_HOST,
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    'api'
  );
  if (!(await waitFor(`${API}/health`))) throw new Error('API did not start');

  /* ── A tenant, as an operator would create ───────────────────────── */
  section('Operator creates the tenant');
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const signup = await http('POST', '/auth/signup', {
    body: {
      name: 'Host Owner',
      username: `host${stamp}`,
      email: `host${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone: `+15559${String(stamp).slice(-6)}`,
    },
  });
  check('an operator account exists', signup.status === 201, `${signup.status} ${signup.data?.message}`);
  const ownerToken = signup.data?.accessToken || signup.data?.token;

  const app = await http('POST', '/apps', {
    token: ownerToken,
    body: { name: 'My SaaS', features: ['chat', 'groups', 'calls', 'video', 'presence', 'meetings'] },
  });
  check('the app is created and the secret returned once', app.status === 201 && !!app.data?.secret, `${app.status}`);
  const APP_ID = app.data?.app?.appId;
  const APP_SECRET = app.data?.secret;

  /* Pin the host's origin, as production should. */
  await http('PATCH', `/apps/${app.data?.app?._id}`, {
    token: ownerToken,
    body: { allowedOrigins: [HOST] },
  });

  /* ── The example host app ────────────────────────────────────────── */
  section('The example SaaS host boots with those credentials');
  track(
    spawn(process.execPath, ['examples/saas-host/server.mjs'], {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        PORT: String(HOST_PORT),
        APP_ID,
        APP_SECRET,
        CHATKONECT_API: `http://127.0.0.1:${API_PORT}`,
        CHATKONECT_HOST: CK_HOST,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    'host'
  );
  check('the host app starts', await waitFor(`${HOST}/`), 'never became reachable');

  /* ── Its one endpoint ────────────────────────────────────────────── */
  section('GET /chat-token — the only endpoint your product must add');
  const tok = await http('GET', '/chat-token?as=alice', { base: HOST });
  check('it returns 200', tok.status === 200, `${tok.status} ${tok.text?.slice(0, 120)}`);
  check('it returns a token', typeof tok.data?.token === 'string' && tok.data.token.length > 20);
  check('it reports the lifetime so the loader can pre-empt expiry', Number(tok.data?.expiresInSeconds) > 0, String(tok.data?.expiresInSeconds));
  check('it reports the granted features', Array.isArray(tok.data?.features) && tok.data.features.includes('calls'), JSON.stringify(tok.data?.features));
  check('THE APP SECRET IS NOT IN THE RESPONSE', !tok.text.includes(APP_SECRET));
  check('…and neither is the app id', !tok.text.includes(APP_ID), 'harmless if present, but nothing needs it here');

  /* The token has to be a real session, not merely a well-formed string. */
  const me = await http('GET', '/auth/me', { token: tok.data?.token });
  check('the minted token authenticates a REAL session', me.status === 200, `${me.status} ${me.data?.message}`);
  check('it resolves to the mapped SaaS user', me.data?.user?.externalId === 'saas-user-alice', me.data?.user?.externalId);
  check('the display name came across', me.data?.user?.name === 'Alice', me.data?.user?.name);

  /* A second window = a second user, which is what makes the demo demonstrable. */
  const tok2 = await http('GET', '/chat-token?as=bob', { base: HOST });
  const me2 = await http('GET', '/auth/me', { token: tok2.data?.token });
  check('a second user provisions and mints independently', me2.data?.user?.externalId === 'saas-user-bob', me2.data?.user?.externalId);
  check('the two tokens are different sessions', tok.data?.token !== tok2.data?.token);

  /* Idempotency matters: the host calls provision on EVERY token request. */
  const again = await http('GET', '/chat-token?as=alice', { base: HOST });
  const meAgain = await http('GET', '/auth/me', { token: again.data?.token });
  check(
    're-minting for the same user is idempotent (no duplicate account)',
    meAgain.data?.user?._id === me.data?.user?._id,
    `${meAgain.data?.user?._id} vs ${me.data?.user?._id}`
  );

  /* ── externalId shapes a real product actually uses ──────────────── */
  section('Realistic externalId shapes provision (the class every fixture missed)');
  /* User.username is capped at 30 and the synthesized tenant prefix eats 19 of
     them, so this used to fail for ANY externalId over five characters — a
     UUID, an email, "saas-user-alice". Every suite passed because every fixture
     used something like 'crm-a'. These are the shapes real integrations send. */
  for (const ext of [
    '550e8400-e29b-41d4-a716-446655440000',
    'user@customer.example.com',
    'saas-user-with-a-very-long-identifier-indeed',
  ]) {
    const r = await http('POST', '/v1/platform/users', {
      base: API,
      body: { externalId: ext, name: `User ${ext.slice(0, 8)}` },
      appHeaders: { appId: APP_ID, secret: APP_SECRET },
    });
    check(`externalId '${ext.slice(0, 24)}…' provisions`, r.status === 201 || r.status === 200, `${r.status} ${r.data?.message}`);
  }
  /* ── The page it serves ──────────────────────────────────────────── */
  section('GET / — the host page');
  const page = await http('GET', '/', { base: HOST });
  check('the page renders', page.status === 200, `${page.status}`);
  check('the loader is pulled from the ChatKonect origin', page.text.includes(`${CK_HOST}/embed.js`), 'embed.js src not substituted');
  check('the real app id is substituted in', page.text.includes(APP_ID), 'placeholder left unreplaced');
  check('no placeholder survives', !page.text.includes('__CK_HOST__') && !page.text.includes('__APP_ID__'));
  check('it mounts into a container', /id="chat"/.test(page.text));
  check('it uses getToken (rotation-capable), not a hardcoded token', page.text.includes('getToken'));
  check('THE APP SECRET IS NOT IN THE PAGE', !page.text.includes(APP_SECRET));

  /* ── The embed config the frame will fetch ───────────────────────── */
  section('The config the framed app will request');
  const cfg = await http('GET', `/v1/embed/config?appId=${APP_ID}&parentOrigin=${encodeURIComponent(HOST)}`);
  check('the pinned host origin is accepted', cfg.status === 200, `${cfg.status} ${cfg.data?.message}`);
  check('it points the loader at the right iframe URL', cfg.data?.endpoints?.embedUrl === `${CK_HOST}/embed`, cfg.data?.endpoints?.embedUrl);

  const wrong = await http('GET', `/v1/embed/config?appId=${APP_ID}&parentOrigin=${encodeURIComponent('http://localhost:9999')}`);
  check('an unpinned origin is refused', wrong.status === 403, `${wrong.status}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(62)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

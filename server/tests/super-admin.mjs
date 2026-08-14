/**
 * The single super admin, provisioned from .env on boot.
 *
 * Two promises to keep:
 *   1. Point MONGO_URI at an EMPTY database and an admin exists after boot —
 *      no manual script, no locked-out deployment. (Signup only ever creates a
 *      plain `user`, so without this a fresh database has no way in at all.)
 *   2. There is exactly ONE. Any other account holding role:'admin' is demoted.
 *
 * Each case boots a real server against a freshly dropped database with its own
 * SUPER_ADMIN_* environment, then checks the result through the API — logging in
 * as the admin and hitting an admin-only route, rather than trusting the row.
 *
 * Run:  node tests/super-admin.mjs   (from /server)
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

const PORT = 5121;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_admin$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

const ADMIN_EMAIL = 'root.super@test.local';
const ADMIN_PASSWORD = 'SuperAdminPass!42';

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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
const bootLog = [];
async function startServer(extraEnv = {}) {
  bootLog.length = 0;
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: TEST_URI,
      NODE_ENV: 'development',
      ENABLE_EMAIL_VERIFICATION: 'false',
      CLIENT_URL: 'http://localhost:5290',
      SUPER_ADMIN_EMAIL: ADMIN_EMAIL,
      SUPER_ADMIN_PASSWORD: ADMIN_PASSWORD,
      SUPER_ADMIN_NAME: 'Root Super',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => bootLog.push(String(d)));
  serverProc.stderr.on('data', (d) => bootLog.push(String(d)));
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${API}/health`)).ok) {
        await sleep(400); // let the boot-time provisioning line land
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Server did not become healthy in time.');
}

async function stopServer() {
  serverProc?.kill();
  serverProc = null;
  await sleep(600);
}

async function finish(code) {
  await stopServer();
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  process.exit(code);
}

const bootSaid = (re) => bootLog.join('\n').match(re);
const login = (email, password) => http('POST', '/auth/login', { body: { identifier: email, email, password } });

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_300_000 + phoneSeq++).slice(0, 7)}`;
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
  return { token: data.accessToken || data.token, id: data.user._id, email: data.user.email, password };
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
  const users = mongoose.connection.db.collection('users');

  /* ── 1. A brand-new database provisions itself ──────────────────── */
  section('Booting against an EMPTY database');
  await startServer();
  check('boot reports the admin was created', !!bootSaid(/Super admin created from \.env/i), bootLog.join('').slice(-200));

  const adminRow = await users.findOne({ email: ADMIN_EMAIL });
  check('the account exists', !!adminRow, 'no user row');
  check("its platform role is 'admin'", adminRow?.role === 'admin', `role=${adminRow?.role}`);
  check('it is verified and active, so it can log in immediately', adminRow?.isVerified === true && adminRow?.accountStatus === 'active');
  check('it has a workspace (without one it can reach nobody)', !!adminRow?.workspace, `workspace=${adminRow?.workspace}`);
  check('the password is stored hashed, not in the clear', !!adminRow?.password && adminRow.password !== ADMIN_PASSWORD);
  check('the name comes from SUPER_ADMIN_NAME', adminRow?.name === 'Root Super', adminRow?.name);

  section('The credentials in .env actually work');
  const logged = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminToken = logged.data?.accessToken || logged.data?.token;
  check('the .env password logs in', logged.status === 200 && !!adminToken, `${logged.status} ${logged.data?.message}`);
  const stats = await http('GET', '/admin/stats', { token: adminToken });
  check('and it really holds admin powers (admin-only route)', stats.status === 200, `${stats.status} ${stats.data?.message}`);

  /* ── 2. Idempotence ─────────────────────────────────────────────── */
  section('Rebooting with the SAME password changes nothing');
  const versionBefore = (await users.findOne({ email: ADMIN_EMAIL }))?.tokenVersion || 0;
  await stopServer();
  await startServer();
  check('boot reports it as already correct', !!bootSaid(/Super admin .* ✓/), bootLog.join('').slice(-200));
  check('still exactly one account with that email', (await users.countDocuments({ email: ADMIN_EMAIL })) === 1);
  const stillIn = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check('the password still works', stillIn.status === 200, `${stillIn.status}`);
  /* The sync must be a no-op when nothing changed. Without the bcrypt compare it
     would re-hash and bump tokenVersion every boot, signing the admin out on
     every restart — on a hosted deploy, on every deploy. */
  check(
    'an unchanged password does not churn sessions (tokenVersion held)',
    ((await users.findOne({ email: ADMIN_EMAIL }))?.tokenVersion || 0) === versionBefore,
    `before=${versionBefore} after=${(await users.findOne({ email: ADMIN_EMAIL }))?.tokenVersion}`
  );

  section('.env is authoritative: changing the password there changes the login');
  const sessionBefore = (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).data;
  const oldToken = sessionBefore?.accessToken || sessionBefore?.token;
  const ROTATED = 'RotatedFromEnv!77';
  await stopServer();
  await startServer({ SUPER_ADMIN_PASSWORD: ROTATED });
  check('boot says the password was reset from .env', !!bootSaid(/password reset from \.env/i), bootLog.join('').slice(-220));
  const withNew = await login(ADMIN_EMAIL, ROTATED);
  check('the NEW .env password logs in', withNew.status === 200, `${withNew.status} ${withNew.data?.message}`);
  const withOld = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check('the OLD password no longer works', withOld.status !== 200, `${withOld.status}`);
  const oldSession = await http('GET', '/admin/stats', { token: oldToken });
  check('sessions issued before the rotation are revoked', oldSession.status === 401, `${oldSession.status}`);

  section('A blank password is "unspecified", not "reset to blank"');
  await stopServer();
  await startServer({ SUPER_ADMIN_PASSWORD: '' });
  const afterBlank = await login(ADMIN_EMAIL, ROTATED);
  check(
    'clearing the .env line cannot lock the owner out',
    afterBlank.status === 200,
    `${afterBlank.status} ${afterBlank.data?.message}`
  );
  // Put it back so the rest of the suite uses the documented password.
  await stopServer();
  await startServer({ SUPER_ADMIN_PASSWORD: ADMIN_PASSWORD });
  check('and the password can be rotated back', (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status === 200);

  /* ── 3. Exactly ONE super admin ─────────────────────────────────── */
  section('A second admin is demoted on the next boot');
  const impostor = await makeUser('impostor');
  await users.updateOne({ _id: new mongoose.Types.ObjectId(impostor.id) }, { $set: { role: 'admin' } });
  check('(setup) a rogue admin exists', (await users.countDocuments({ role: 'admin' })) === 2);

  await stopServer();
  await startServer();
  check('boot reports the demotion', !!bootSaid(/demoted 1 other admin/i), bootLog.join('').slice(-200));
  check('exactly one admin remains', (await users.countDocuments({ role: 'admin' })) === 1);
  const survivor = await users.findOne({ role: 'admin' });
  check('and it is the configured one', survivor?.email === ADMIN_EMAIL, survivor?.email);
  const demoted = await users.findOne({ _id: new mongoose.Types.ObjectId(impostor.id) });
  check("the demoted user keeps their account, just not the role", demoted?.role === 'user' && demoted?.accountStatus === 'active', `role=${demoted?.role}`);
  const impostorStats = await http('GET', '/admin/stats', { token: impostor.token });
  check('the demoted user is refused by admin routes', impostorStats.status === 403, `${impostorStats.status}`);

  /* ── 4. Promoting an account that already exists ────────────────── */
  section('An existing plain user named in .env is promoted, not duplicated');
  await stopServer();
  const promotee = { email: `promote${Date.now()}@test.local`, password: 'PlainUserPass!9' };
  await startServer({ SUPER_ADMIN_EMAIL: ADMIN_EMAIL }); // need the API up to sign them up
  const signed = await http('POST', '/auth/signup', {
    body: {
      name: 'Was A User',
      username: `promote${Date.now()}`,
      email: promotee.email,
      password: promotee.password,
      confirmPassword: promotee.password,
      phone: `+1555${String(8_400_000 + phoneSeq++).slice(0, 7)}`,
    },
  });
  check('(setup) a plain user exists', signed.status === 201, `${signed.status}`);
  await stopServer();
  const PROMOTED_PW = 'PromotedByEnv!31';
  await startServer({ SUPER_ADMIN_EMAIL: promotee.email, SUPER_ADMIN_PASSWORD: PROMOTED_PW });
  check('boot reports a repair rather than a create', !!bootSaid(/Super admin .* (repaired|✓)/i), bootLog.join('').slice(-200));
  check('no duplicate account was made', (await users.countDocuments({ email: promotee.email })) === 1);
  const promoted = await users.findOne({ email: promotee.email });
  check('the existing account now holds the role', promoted?.role === 'admin');
  const promotedLogin = await login(promotee.email, PROMOTED_PW);
  check(
    'the .env password takes over the promoted account',
    promotedLogin.status === 200,
    `${promotedLogin.status} ${promotedLogin.data?.message}`
  );
  check(
    "and their old self-chosen password stops working",
    (await login(promotee.email, promotee.password)).status !== 200
  );
  check('the previous admin was demoted in turn', (await users.countDocuments({ role: 'admin' })) === 1);

  /* ── 5. Misconfiguration degrades loudly, never fatally ─────────── */
  section('A missing configuration warns but still serves');
  await stopServer();
  await startServer({ SUPER_ADMIN_EMAIL: '', SUPER_ADMIN_PASSWORD: '' });
  check('the API still boots with no SUPER_ADMIN_EMAIL', (await fetch(`${API}/health`)).ok);
  check('and says so in the log', !!bootSaid(/No SUPER_ADMIN_EMAIL configured/i), bootLog.join('').slice(-200));

  await stopServer();
  await startServer({ SUPER_ADMIN_EMAIL: 'brand.new@test.local', SUPER_ADMIN_PASSWORD: 'short' });
  check('a too-short password does not create a half-made admin', (await users.countDocuments({ email: 'brand.new@test.local' })) === 0);
  check('and the reason is logged', !!bootSaid(/SUPER_ADMIN_PASSWORD is missing or under 8/i), bootLog.join('').slice(-200));

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

/**
 * Embeddable-platform suite — tenants, provisioning, token exchange, isolation
 * and per-app feature flags.
 *
 * The isolation checks are the point of this file. Everything else here could be
 * verified by reading the code; "customer A cannot see customer B's users"
 * cannot, because it depends on every discovery path being scoped, and those are
 * spread across four controllers. A regression there is a cross-customer data
 * leak, so it gets asserted from the outside, as a real API caller.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5134;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env'); process.exit(1); }
const TEST_DB = process.env.PLATFORM_TEST_DB || 'chatconnect_t_platform';
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

async function http(method, url, { token, appId, secret, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (secret) headers.Authorization = `Bearer ${secret}`;
  if (appId) headers['X-CC-App-Id'] = appId;
  const res = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
const nextPhone = () => `+1888${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(2, '0')}`;

/** A normal first-party ChatConnect account (the one that owns tenants). */
async function makeOwner(tag) {
  const u = { name: `PF ${tag}`, email: `pf.${tag}.${uniq()}@chatconnect.app`, password: 'PasswordP1!', phone: nextPhone() };
  const s = await http('POST', '/auth/signup', { body: { ...u, confirmPassword: u.password } });
  if (s.status >= 400) throw new Error(`signup: ${s.status} ${JSON.stringify(s.data)}`);
  const l = await http('POST', '/auth/login', { body: { identifier: u.email, password: u.password } });
  if (!l.data?.token) throw new Error(`login: ${l.status} ${JSON.stringify(l.data)}`);
  return { ...u, token: l.data.token, id: l.data.user._id };
}

/** Drop the test DB BEFORE the run, not just after.
 *  Two reasons: a previous crashed run must not leave state that changes this
 *  one's result, and on a capped cluster dropping first is what frees the
 *  collection budget the fresh run then needs. */
async function resetTestDb() {
  /* Same workaround as the other suites: this process connects to Atlas
     directly (the server subprocess gets it from config/db.js), and the local
     resolver here can't do SRV lookups for a mongodb+srv URI. */
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function main() {
  await resetTestDb();
  await startServer();
  const owner = await makeOwner('owner');

  // ── 1. Tenant lifecycle ─────────────────────────────────────────
  head('Tenant lifecycle');
  const created = await http('POST', '/apps', { token: owner.token, body: { name: 'Acme CRM' } });
  const appA = created.data?.app;
  const secretA = created.data?.secret;
  check('an app can be created', created.status === 201 && !!appA?.appId, `${created.status}`);
  check('the secret is returned exactly once, at creation', typeof secretA === 'string' && secretA.startsWith('cc_sk_'), String(secretA).slice(0, 10));
  check('the secret HASH is never serialised back', appA?.secretHash === undefined, 'secretHash leaked to the client');

  const listed = await http('GET', '/apps', { token: owner.token });
  check('the owner can list their apps', listed.status === 200 && listed.data.apps.length >= 1, `${listed.status}`);
  check('listing never includes the secret hash', (listed.data.apps || []).every((a) => a.secretHash === undefined), 'hash present in list');

  const who = await http('GET', '/v1/platform/whoami', { appId: appA.appId, secret: secretA });
  check('the app secret authenticates against the platform API', who.status === 200 && who.data.app.appId === appA.appId, `${who.status}`);

  const wrongSecret = await http('GET', '/v1/platform/whoami', { appId: appA.appId, secret: 'cc_sk_not_the_real_one' });
  check('a wrong secret is rejected', wrongSecret.status === 401, `${wrongSecret.status}`);
  const noAppId = await http('GET', '/v1/platform/whoami', { secret: secretA });
  check('a missing X-CC-App-Id is rejected', noAppId.status === 401, `${noAppId.status}`);

  // ── 2. Provisioning + token exchange ────────────────────────────
  head('Provisioning & token exchange');
  const u1 = await http('POST', '/v1/platform/users', { appId: appA.appId, secret: secretA, body: { externalId: 'crm-1', name: 'Ada Lovelace' } });
  check('an end user can be provisioned', u1.status === 201 && u1.data.created === true, `${u1.status} ${JSON.stringify(u1.data)?.slice(0, 90)}`);

  const again = await http('POST', '/v1/platform/users', { appId: appA.appId, secret: secretA, body: { externalId: 'crm-1', name: 'Ada L.' } });
  check('re-provisioning the same externalId UPSERTS (no duplicate)', again.status === 200 && again.data.created === false, `${again.status}`);
  check('the upsert updated the profile', again.data?.user?.name === 'Ada L.', again.data?.user?.name);

  const noExt = await http('POST', '/v1/platform/users', { appId: appA.appId, secret: secretA, body: { name: 'No id' } });
  check('externalId is required', noExt.status === 400, `${noExt.status}`);

  const tok = await http('POST', '/v1/platform/tokens', { appId: appA.appId, secret: secretA, body: { externalId: 'crm-1' } });
  check('a short-lived end-user token is minted', tok.status === 200 && typeof tok.data.token === 'string', `${tok.status}`);
  check('the token response echoes the granted features', Array.isArray(tok.data?.features), JSON.stringify(tok.data?.features));
  check('the token expiry is bounded (<= 24h)', tok.data?.expiresInSeconds > 0 && tok.data.expiresInSeconds <= 86_400, `${tok.data?.expiresInSeconds}`);

  const userToken = tok.data.token;
  const me = await http('GET', '/auth/me', { token: userToken });
  check('the end-user token works on the NORMAL protected API', me.status === 200, `${me.status}`);
  check('...and resolves to the provisioned end user', String(me.data?.user?._id) === String(tok.data.user.id), `${me.data?.user?._id}`);

  const ghost = await http('POST', '/v1/platform/tokens', { appId: appA.appId, secret: secretA, body: { externalId: 'never-provisioned' } });
  check('a token cannot be minted for an unprovisioned user', ghost.status === 404, `${ghost.status}`);

  // ── 3. Cross-tenant isolation ───────────────────────────────────
  head('Cross-tenant isolation');
  const createdB = await http('POST', '/apps', { token: owner.token, body: { name: 'Globex Helpdesk' } });
  const appB = createdB.data.app;
  const secretB = createdB.data.secret;
  await http('POST', '/v1/platform/users', { appId: appB.appId, secret: secretB, body: { externalId: 'hd-1', name: 'Grace Hopper' } });
  const tokB = await http('POST', '/v1/platform/tokens', { appId: appB.appId, secret: secretB, body: { externalId: 'hd-1' } });
  const userTokenB = tokB.data.token;

  // Two tenants may use the SAME external id — that's the point of namespacing.
  const collide = await http('POST', '/v1/platform/users', { appId: appB.appId, secret: secretB, body: { externalId: 'crm-1', name: 'Different Person' } });
  check('two tenants can both use externalId "crm-1"', collide.status === 201, `${collide.status} ${JSON.stringify(collide.data)?.slice(0, 90)}`);

  const listA = await http('GET', '/v1/platform/users', { appId: appA.appId, secret: secretA });
  const extIdsA = (listA.data?.users || []).map((u) => u.externalId);
  check('a tenant only lists its OWN users', !extIdsA.includes('hd-1'), JSON.stringify(extIdsA));

  // The end user of A must not be able to reach the end user of B by ANY route.
  const bUserId = tokB.data.user.id;
  const bEmailProbe = await http('GET', `/users/search?q=${encodeURIComponent('hd-1')}`, { token: userToken });
  check('search cannot surface another tenant\'s user', !JSON.stringify(bEmailProbe.data || {}).includes(String(bUserId)), 'cross-tenant user in search results');

  const globalProbe = await http('GET', `/search?q=${encodeURIComponent('Grace')}`, { token: userToken });
  check('global search cannot surface another tenant\'s user', !JSON.stringify(globalProbe.data?.people || []).includes(String(bUserId)), 'cross-tenant user in global search');

  const byId = await http('GET', `/users/${bUserId}`, { token: userToken });
  check('fetching another tenant\'s user by id returns 404', byId.status === 404, `${byId.status}`);

  const contactReq = await http('POST', `/contacts/request/${bUserId}`, { token: userToken });
  check('a contact request across tenants is refused', contactReq.status === 404, `${contactReq.status}`);

  const group = await http('POST', '/groups', { token: userToken, body: { name: 'Cross tenant', members: [bUserId] } });
  const members = group.data?.chat?.participants || [];
  check('a cross-tenant user cannot be added to a group', !members.some((p) => String(p.user?._id || p.user) === String(bUserId)), 'cross-tenant member was added');

  // And the first-party world stays separate in both directions.
  const firstPartyProbe = await http('GET', `/users/${owner.id}`, { token: userToken });
  check('a tenant user cannot read a FIRST-PARTY account', firstPartyProbe.status === 404, `${firstPartyProbe.status}`);
  const ownerSeesTenant = await http('GET', `/users/${bUserId}`, { token: owner.token });
  check('a first-party user cannot read a TENANT account', ownerSeesTenant.status === 404, `${ownerSeesTenant.status}`);

  // ── 4. Feature flags ────────────────────────────────────────────
  head('Feature flags');
  // Defaults grant chat/groups but NOT calls or meetings.
  const callBlocked = await http('POST', '/calls', { token: userToken, body: { receiverId: bUserId, type: 'audio' } });
  check('a feature the app lacks is refused with 403', callBlocked.status === 403, `${callBlocked.status}`);
  check('the refusal names the missing feature', /calls/.test(callBlocked.data?.message || ''), callBlocked.data?.message);

  const meetBlocked = await http('POST', '/meetings', { token: userToken, body: { title: 'Nope', startAt: new Date(Date.now() + 60000).toISOString() } });
  check('meetings are refused when not granted', meetBlocked.status === 403, `${meetBlocked.status}`);

  const grant = await http('PATCH', `/apps/${appA._id}`, { token: owner.token, body: { features: ['chat', 'groups', 'calls', 'meetings'] } });
  check('the owner can grant features', grant.status === 200 && grant.data.app.features.includes('meetings'), `${grant.status}`);

  const meetOk = await http('POST', '/meetings', { token: userToken, body: { title: 'Now allowed', startAt: new Date(Date.now() + 60000).toISOString() } });
  check('the same call succeeds once the feature is granted', meetOk.status === 201, `${meetOk.status} ${meetOk.data?.message || ''}`);

  const badFeature = await http('PATCH', `/apps/${appA._id}`, { token: owner.token, body: { features: ['chat', 'mine-bitcoin'] } });
  check('an unknown feature name is rejected', badFeature.status === 400, `${badFeature.status}`);

  // ── 5. Secret rotation + disable ────────────────────────────────
  head('Rotation & disable');
  const rotated = await http('POST', `/apps/${appA._id}/rotate`, { token: owner.token });
  check('the secret can be rotated', rotated.status === 200 && rotated.data.secret !== secretA, `${rotated.status}`);
  const oldSecret = await http('GET', '/v1/platform/whoami', { appId: appA.appId, secret: secretA });
  check('the OLD secret stops working after rotation', oldSecret.status === 401, `${oldSecret.status}`);
  const newSecret = await http('GET', '/v1/platform/whoami', { appId: appA.appId, secret: rotated.data.secret });
  check('the new secret works', newSecret.status === 200, `${newSecret.status}`);

  const stats = await http('GET', `/apps/${appA._id}/stats`, { token: owner.token });
  check('the console can read live per-app stats', stats.status === 200 && stats.data.stats.users >= 1, `${stats.status} ${JSON.stringify(stats.data?.stats)}`);

  const otherOwner = await makeOwner('intruder');
  const steal = await http('GET', `/apps/${appA._id}/stats`, { token: otherOwner.token });
  check("another account cannot read someone else's app", steal.status === 404, `${steal.status}`);
  const stealPatch = await http('PATCH', `/apps/${appA._id}`, { token: otherOwner.token, body: { name: 'Mine now' } });
  check("another account cannot modify someone else's app", stealPatch.status === 404, `${stealPatch.status}`);

  const disabled = await http('DELETE', `/apps/${appA._id}`, { token: owner.token });
  check('an app can be disabled', disabled.status === 200, `${disabled.status}`);
  const afterDisable = await http('GET', '/v1/platform/whoami', { appId: appA.appId, secret: rotated.data.secret });
  check('a disabled app cannot use the platform API', afterDisable.status === 403, `${afterDisable.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'─'.repeat(56)}`);
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

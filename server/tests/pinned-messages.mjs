/**
 * End-to-end tests for timed pinned messages.
 *
 * Covers the rules the feature is defined by:
 *   • durations are 1 / 6 / 12 / 24 hours and nothing else;
 *   • in a GROUP only admins may pin, in a direct chat either person may;
 *   • whoever pinned can unpin, and group admins can clear anyone's;
 *   • a lapsed pin is invisible to reads even before the sweeper runs, and the
 *     sweeper then removes it for real;
 *   • the 3-pin cap evicts the oldest instead of failing;
 *   • pins ride along on the first page of messages (and not on back-pages).
 *
 * Run:  node tests/pinned-messages.mjs   (from /server)
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

const PORT = 5104;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run tests.');
  process.exit(1);
}
// Shares the throwaway database with tests/search-wallpaper.mjs rather
// than minting a new one. Deliberate: the Atlas free tier caps the CLUSTER at
// 500 collections, and one database per suite (~20 collections each) is what
// exhausted it. Both suites drop the database on entry and CI runs them in
// sequence, so sharing is safe — just never run them concurrently.
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_feat$2');
if (TEST_URI === baseUri) {
  console.error('Refusing to run: could not derive an isolated test database name.');
  process.exit(1);
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`— ${t}`);

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) console.error('[server]', s.trim().slice(0, 300));
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

let phoneSeq = 0;
async function makeUser(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const email = `${tag}${stamp}@test.local`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(3_000_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: { name: `${tag.toUpperCase()} Pinner`, username: `${tag}${stamp}`, email, password, confirmPassword: password, phone },
  });
  if (status !== 201 || !data?.user?._id) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name, email };
}

async function send(user, chatId, content) {
  const { data } = await http('POST', '/messages', { token: user.token, body: { chatId, content } });
  return data.message;
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
  const chats = mongoose.connection.db.collection('chats');

  const A = await makeUser('ann'); // group owner
  const B = await makeUser('ben'); // plain group member
  const C = await makeUser('cat'); // outsider to the group

  for (const [x, y] of [[A, B], [A, C], [B, C]]) {
    await http('POST', `/contacts/request/${y.id}`, { token: x.token });
    const { data } = await http('GET', '/contacts/requests', { token: y.token });
    const req = (data.incoming || []).find((r) => String(r.from?._id) === String(x.id));
    if (req) await http('PATCH', `/contacts/request/${req._id}`, { token: y.token, body: { action: 'accept' } });
  }

  const { data: dm } = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  const dmId = dm.chat._id;
  const { data: grp } = await http('POST', '/groups', { token: A.token, body: { name: 'Pin Squad', members: [B.id] } });
  const gid = grp.chat._id;

  /* ── Durations ────────────────────────────────────────────────── */
  section('Durations');
  const m1 = await send(A, dmId, 'pin me for a while');
  {
    for (const hours of [1, 6, 12, 24]) {
      const { status, data } = await http('POST', `/messages/${m1._id}/pin`, { token: A.token, body: { hours } });
      const ms = new Date(data?.pin?.expiresAt).getTime() - Date.now();
      const expected = hours * 3600_000;
      check(
        `${hours}h pin accepted and expires in ~${hours}h`,
        status === 200 && Math.abs(ms - expected) < 60_000,
        `status ${status}, off by ${Math.round((ms - expected) / 1000)}s`
      );
    }
    for (const bad of [3, 0, -1, 48, 1.5, 'abc', undefined]) {
      const { status } = await http('POST', `/messages/${m1._id}/pin`, { token: A.token, body: { hours: bad } });
      check(`duration ${JSON.stringify(bad)} rejected`, status === 400, `got ${status}`);
    }
  }
  {
    // Re-pinning replaces rather than duplicating — the array must not grow.
    const row = await chats.findOne({ _id: new mongoose.Types.ObjectId(dmId) });
    check('re-pinning the same message keeps ONE entry', (row.pins || []).length === 1, `got ${row.pins?.length}`);
    check('and it recorded the chosen duration', row.pins[0].durationHours === 24);
  }

  /* ── Direct chat: either person may pin ───────────────────────── */
  section('Direct chats');
  {
    const m = await send(B, dmId, 'B pins in a DM');
    const { status } = await http('POST', `/messages/${m._id}/pin`, { token: B.token, body: { hours: 1 } });
    check('either participant can pin in a direct chat', status === 200, `got ${status}`);

    const { data } = await http('GET', `/messages/${dmId}/pins`, { token: B.token });
    check('canPin is true for a DM participant', data.canPin === true);

    const outsider = await http('POST', `/messages/${m._id}/pin`, { token: C.token, body: { hours: 1 } });
    check('a non-member cannot pin', outsider.status === 403, `got ${outsider.status}`);
  }

  /* ── Groups: admins only ─────────────────────────────────────── */
  section('Groups — admins only');
  const gm = await send(A, gid, 'group announcement');
  {
    const { status } = await http('POST', `/messages/${gm._id}/pin`, { token: A.token, body: { hours: 6 } });
    check('group owner can pin', status === 200, `got ${status}`);

    const member = await http('POST', `/messages/${gm._id}/pin`, { token: B.token, body: { hours: 6 } });
    check('a plain member CANNOT pin in a group', member.status === 403, `got ${member.status}`);
    check('and is told why', /admin/i.test(member.data?.message || ''), member.data?.message);

    const { data: mine } = await http('GET', `/messages/${gid}/pins`, { token: B.token });
    check('canPin is false for a plain member', mine.canPin === false);
    check('but the member still SEES the pin', mine.pins?.length === 1);

    // Promote B and the same call must now succeed.
    await http('PATCH', `/groups/${gid}/members/${B.id}/role`, { token: A.token, body: { role: 'admin' } });
    const promoted = await http('POST', `/messages/${gm._id}/pin`, { token: B.token, body: { hours: 12 } });
    check('once promoted to admin, the member can pin', promoted.status === 200, `got ${promoted.status}`);
  }

  /* ── Unpinning ───────────────────────────────────────────────── */
  section('Unpinning');
  {
    // A re-pins so the pin belongs to A, then B is demoted — otherwise B is
    // still the pinner (they pinned it while briefly an admin above) and the
    // "pinner can always unpin" rule would legitimately let them through, which
    // is not the rule under test here.
    await http('POST', `/messages/${gm._id}/pin`, { token: A.token, body: { hours: 6 } });
    await http('PATCH', `/groups/${gid}/members/${B.id}/role`, { token: A.token, body: { role: 'member' } });
    const { status } = await http('DELETE', `/messages/${gm._id}/pin`, { token: B.token });
    check("a plain member can't unpin someone else's pin", status === 403, `got ${status}`);

    const admin = await http('DELETE', `/messages/${gm._id}/pin`, { token: A.token });
    check('an admin can unpin', admin.status === 200);
    const { data } = await http('GET', `/messages/${gid}/pins`, { token: A.token });
    check('the pin is gone', (data.pins || []).length === 0);

    const again = await http('DELETE', `/messages/${gm._id}/pin`, { token: A.token });
    check('unpinning something not pinned is a no-op, not an error', again.status === 200);
  }
  {
    // The pinner keeps the right to remove their own even without admin.
    await http('PATCH', `/groups/${gid}/members/${B.id}/role`, { token: A.token, body: { role: 'admin' } });
    const own = await send(B, gid, 'B pins their own');
    await http('POST', `/messages/${own._id}/pin`, { token: B.token, body: { hours: 1 } });
    await http('PATCH', `/groups/${gid}/members/${B.id}/role`, { token: A.token, body: { role: 'member' } });
    const { status } = await http('DELETE', `/messages/${own._id}/pin`, { token: B.token });
    check('whoever pinned it can always unpin it', status === 200, `got ${status}`);
  }

  /* ── The 3-pin cap ───────────────────────────────────────────── */
  section('Cap of 3 pins');
  {
    const made = [];
    for (let i = 0; i < 4; i += 1) {
      const m = await send(A, gid, `capped ${i}`);
      made.push(m);
      await http('POST', `/messages/${m._id}/pin`, { token: A.token, body: { hours: 24 } });
      await sleep(20); // keep pinnedAt strictly ordered
    }
    const { data } = await http('GET', `/messages/${gid}/pins`, { token: A.token });
    check('never more than 3 pins', data.pins.length === 3, `got ${data.pins.length}`);
    const ids = data.pins.map((p) => p.messageId);
    check('the OLDEST was evicted', !ids.includes(String(made[0]._id)));
    check('the newest is kept', ids.includes(String(made[3]._id)));

    const row = await chats.findOne({ _id: new mongoose.Types.ObjectId(gid) });
    check('the database matches (no orphan rows)', (row.pins || []).length === 3, `got ${row.pins?.length}`);
  }

  /* ── Pins on the message feed ────────────────────────────────── */
  section('Pins on the message feed');
  {
    const { data } = await http('GET', `/messages/${gid}?limit=10`, { token: A.token });
    check('first page carries the pins', Array.isArray(data.pins) && data.pins.length === 3);
    check('first page carries canPin', data.canPin === true);
    check('pinned messages arrive populated', !!data.pins[0]?.message?.content && !!data.pins[0]?.message?.sender?.name);

    const { data: back } = await http('GET', `/messages/${gid}?limit=10&before=${new Date().toISOString()}`, { token: A.token });
    check('back-pages omit them (already on screen)', back.pins === undefined);
  }

  /* ── Expiry ──────────────────────────────────────────────────── */
  section('Expiry');
  {
    // Backdate every pin on the group past its expiry.
    await chats.updateOne(
      { _id: new mongoose.Types.ObjectId(gid) },
      { $set: { 'pins.$[].expiresAt': new Date(Date.now() - 60_000) } }
    );

    const { data } = await http('GET', `/messages/${gid}/pins`, { token: A.token });
    check('reads hide a lapsed pin immediately, before any sweep', (data.pins || []).length === 0);

    const { data: feed } = await http('GET', `/messages/${gid}?limit=5`, { token: A.token });
    check('the message feed hides it too', (feed.pins || []).length === 0);

    const still = await chats.findOne({ _id: new mongoose.Types.ObjectId(gid) });
    check('the rows are still in the DB until swept', (still.pins || []).length === 3);

    // Now run the real sweeper in-process (emitToChat no-ops with no io here).
    const { sweepExpiredPins } = await import('../utils/pins.js');
    await sweepExpiredPins();
    const swept = await chats.findOne({ _id: new mongoose.Types.ObjectId(gid) });
    check('the sweeper removes them for real', (swept.pins || []).length === 0);

    // A live pin must survive the sweep untouched.
    const fresh = await send(A, gid, 'survivor');
    await http('POST', `/messages/${fresh._id}/pin`, { token: A.token, body: { hours: 24 } });
    await sweepExpiredPins();
    const after = await chats.findOne({ _id: new mongoose.Types.ObjectId(gid) });
    check('a live pin survives the sweep', (after.pins || []).length === 1);
  }

  /* ── Edge cases ──────────────────────────────────────────────── */
  section('Edge cases');
  {
    const doomed = await send(A, dmId, 'about to be deleted');
    await http('DELETE', `/messages/${doomed._id}?scope=everyone`, { token: A.token });
    const { status } = await http('POST', `/messages/${doomed._id}/pin`, { token: A.token, body: { hours: 1 } });
    check('a deleted message cannot be pinned', status === 400, `got ${status}`);

    const ghost = await http('POST', `/messages/${new mongoose.Types.ObjectId()}/pin`, { token: A.token, body: { hours: 1 } });
    check('an unknown message is a 404', ghost.status === 404, `got ${ghost.status}`);

    const outsider = await http('GET', `/messages/${gid}/pins`, { token: C.token });
    check('a non-member cannot list a chat\'s pins', outsider.status === 403, `got ${outsider.status}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed}/${results.length} checks passed`);
  for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ ${r.name}`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nFATAL:', err);
  await finish(1);
});

/**
 * Group membership: do the people you pick actually END UP in the group, and is
 * "Settings → Privacy → Who can add me to groups" what decides it?
 *
 * Written for a reported bug: A created a group with B and C, the app said it
 * worked — and B and C never saw the group on their own accounts. Cause:
 * createGroup resolved the member ids with `workspace: req.user.workspace`, so
 * every contact who did not share the creator's workspace was dropped from the
 * participant list SILENTLY. Contacts, DMs and calls all cross that boundary by
 * design (global reachability), so the group came back containing nobody but
 * its creator and still answered 201.
 *
 * The gate is now the invitee's own groupAddPermission, which is the control
 * the Settings screen actually offers. So the checks below are in two halves:
 *   - 'everyone' (the default) → the invitee IS added and SEES the group;
 *   - 'contacts'               → only their contacts can add them, and the
 *                                creator is TOLD who was left out.
 * Reading the group back as the invitee is the point — a participant row that
 * the invitee's own chat list never shows is the bug this suite exists for.
 *
 * Run:  node tests/group-membership.mjs   (from /server)
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

const PORT = 5117;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/(chatconnect)(\?|$)/, '/chatconnect_t_grp$2');
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

let phoneSeq = 0;
async function makeUser(tag, extra = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const password = 'Passw0rd!23';
  const phone = `+1555${String(8_100_000 + phoneSeq++).slice(0, 7)}`;
  const { status, data } = await http('POST', '/auth/signup', {
    body: {
      name: `${tag.toUpperCase()} Tester`,
      username: `${tag}${stamp}`,
      email: `${tag}${stamp}@test.local`,
      password,
      confirmPassword: password,
      phone,
      ...extra,
    },
  });
  if (status !== 201) throw new Error(`signup ${tag} failed (${status}): ${data?.message}`);
  return { token: data.accessToken || data.token, id: data.user._id, name: data.user.name };
}

/** Make two accounts mutual contacts (request + accept). */
async function connect(a, b) {
  await http('POST', `/contacts/request/${b.id}`, { token: a.token });
  const { data } = await http('GET', '/contacts/requests', { token: b.token });
  const req = (data?.incoming || []).find((r) => String(r.from?._id) === String(a.id));
  if (!req) throw new Error(`no incoming contact request from ${a.name} to ${b.name}`);
  await http('PATCH', `/contacts/request/${req._id}`, { token: b.token, body: { action: 'accept' } });
}

const memberIds = (chat) => (chat?.participants || []).map((p) => String(p.user?._id || p.user));
/** Does this user's OWN chat list contain the group? The bug lived exactly here. */
const seesChat = async (user, chatId) => {
  const { data } = await http('GET', '/chats', { token: user.token });
  return (data?.chats || []).some((c) => String(c._id) === String(chatId));
};
const setGroupPrivacy = (user, value) =>
  http('PATCH', '/users/me/privacy', { token: user.token, body: { groupAddPermission: value } });

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

  // A is in their OWN team workspace; B, C and D are personal accounts (the
  // shared Personal space). That split is the exact shape of the reported bug —
  // A's contacts live in a different workspace to A.
  const A = await makeUser('alpha', { accountType: 'workspace', workspaceName: 'Alpha Co' });
  const B = await makeUser('bravo');
  const C = await makeUser('charlie');
  const D = await makeUser('delta'); // a stranger to everyone
  await connect(A, B);
  await connect(A, C);

  /* ── The reported bug ───────────────────────────────────────────── */
  section('A creates a group with B and C (contacts in another workspace)');
  const created = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Team Sync', members: [B.id, C.id] },
  });
  const group = created.data?.chat;
  check('the group is created', created.status === 201, `${created.status} ${created.data?.message}`);
  check(
    'B and C are really in the participant list',
    memberIds(group).includes(B.id) && memberIds(group).includes(C.id),
    `participants=${memberIds(group).length}: ${JSON.stringify(memberIds(group))}`
  );
  check('nobody was silently dropped', (created.data?.skipped || []).length === 0, JSON.stringify(created.data?.skipped));
  check('B SEES the group on their own account', await seesChat(B, group?._id));
  check('C SEES the group on their own account', await seesChat(C, group?._id));
  const groupRow = await chats.findOne({ _id: new mongoose.Types.ObjectId(String(group?._id)) });
  check(
    'a mixed-workspace group is owned by neither workspace (so no member sweep can gut it)',
    groupRow?.workspace === null || groupRow?.workspace === undefined,
    `workspace=${groupRow?.workspace}`
  );

  /* ── The setting: 'contacts' ────────────────────────────────────── */
  section('C sets "who can add me to groups" = contacts');
  const savedPriv = await setGroupPrivacy(C, 'contacts');
  check('the setting saves', savedPriv.status === 200 && savedPriv.data?.privacy?.groupAddPermission === 'contacts');

  const byStranger = await http('POST', '/groups', {
    token: D.token,
    body: { name: 'Cold Outreach', members: [C.id] },
  });
  check('a STRANGER cannot add C', !memberIds(byStranger.data?.chat).includes(C.id), JSON.stringify(memberIds(byStranger.data?.chat)));
  check(
    'and the creator is told why, by name',
    (byStranger.data?.skipped || []).some((s) => String(s.user) === String(C.id) && s.reason === 'privacy' && s.name),
    JSON.stringify(byStranger.data?.skipped)
  );
  check("C's chat list does not show the stranger's group", !(await seesChat(C, byStranger.data?.chat?._id)));

  const byContact = await http('POST', '/groups', {
    token: A.token,
    body: { name: 'Close Friends', members: [C.id] },
  });
  check('a CONTACT can still add C', memberIds(byContact.data?.chat).includes(C.id), JSON.stringify(byContact.data?.skipped));
  check('C sees the group their contact made', await seesChat(C, byContact.data?.chat?._id));

  /* ── The same gate on the add-members endpoint ──────────────────── */
  section('Adding members to an existing group honours the same rule');
  const dGroup = await http('POST', '/groups', { token: D.token, body: { name: 'Delta Room', members: [] } });
  const dGroupId = dGroup.data?.chat?._id;
  const addC = await http('POST', `/groups/${dGroupId}/members`, { token: D.token, body: { members: [C.id] } });
  check('the stranger cannot add C to their existing group either', !memberIds(addC.data?.chat).includes(C.id));
  check('…and is told why', (addC.data?.skipped || []).some((s) => s.reason === 'privacy'), JSON.stringify(addC.data?.skipped));

  const addB = await http('POST', `/groups/${group?._id}/members`, { token: A.token, body: { members: [D.id] } });
  check('an admin CAN add a default ("everyone") user from another workspace', memberIds(addB.data?.chat).includes(D.id), JSON.stringify(addB.data?.skipped));
  check('the newly added member sees the group immediately', await seesChat(D, group?._id));
  check(
    'the added member is populated in the response (the roster renders without a refetch)',
    (addB.data?.chat?.participants || []).some((p) => String(p.user?._id) === String(D.id) && p.user?.name),
    JSON.stringify((addB.data?.chat?.participants || []).map((p) => p.user?.name))
  );
  // The panel only offers "Add" to owner/admin — this is the gate it mirrors.
  const byPlainMember = await http('POST', `/groups/${group?._id}/members`, { token: B.token, body: { members: [D.id] } });
  check('a plain member cannot add anyone', byPlainMember.status === 403, `${byPlainMember.status} ${byPlainMember.data?.message}`);

  /* ── The setting: 'everyone' ────────────────────────────────────── */
  section('"everyone" means everyone (global reachability)');
  await setGroupPrivacy(C, 'everyone');
  const openAdd = await http('POST', '/groups', { token: D.token, body: { name: 'Open Doors', members: [C.id] } });
  check('the stranger can now add C', memberIds(openAdd.data?.chat).includes(C.id), JSON.stringify(openAdd.data?.skipped));
  check('C sees it', await seesChat(C, openAdd.data?.chat?._id));

  section('A block beats "everyone"');
  await http('POST', `/users/me/block/${D.id}`, { token: C.token });
  const blockedAdd = await http('POST', '/groups', { token: D.token, body: { name: 'Nope', members: [C.id] } });
  check('a user who blocked you cannot be pulled into your group', !memberIds(blockedAdd.data?.chat).includes(C.id));
  check('reported as blocked', (blockedAdd.data?.skipped || []).some((s) => s.reason === 'blocked'), JSON.stringify(blockedAdd.data?.skipped));
  await http('POST', `/users/me/block/${D.id}`, { token: C.token }); // toggle back off

  // …and the other direction: you can't add someone YOU blocked either.
  await http('POST', `/users/me/block/${C.id}`, { token: D.token });
  const iBlocked = await http('POST', '/groups', { token: D.token, body: { name: 'Also Nope', members: [C.id] } });
  check('you cannot add someone you blocked yourself', !memberIds(iBlocked.data?.chat).includes(C.id), JSON.stringify(iBlocked.data?.skipped));
  await http('POST', `/users/me/block/${C.id}`, { token: D.token }); // toggle back off

  /* ── Regressions the resolver must not introduce ────────────────── */
  section('Robustness');
  const sameWs = await http('POST', '/groups', { token: B.token, body: { name: 'Personal Pals', members: [C.id] } });
  const sameWsRow = await chats.findOne({ _id: new mongoose.Types.ObjectId(String(sameWs.data?.chat?._id)) });
  check('a group whose members all share one workspace keeps that tag', !!sameWsRow?.workspace, `workspace=${sameWsRow?.workspace}`);

  const junk = await http('POST', '/groups', { token: A.token, body: { name: 'Junk', members: ['not-an-id', String(new mongoose.Types.ObjectId())] } });
  check('a malformed / unknown member id is a clean skip, not a 500', junk.status === 201, `${junk.status} ${junk.data?.message}`);
  check('both are reported as not_found', (junk.data?.skipped || []).filter((s) => s.reason === 'not_found').length === 2, JSON.stringify(junk.data?.skipped));

  const dupes = await http('POST', '/groups', { token: A.token, body: { name: 'Dupes', members: [B.id, B.id, A.id] } });
  check('duplicate ids and self-adds do not double up the roster', memberIds(dupes.data?.chat).length === 2, JSON.stringify(memberIds(dupes.data?.chat)));

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  await finish(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('\nSUITE CRASHED:', err);
  await finish(1);
});

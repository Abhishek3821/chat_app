/**
 * Broad feature-coverage smoke test.
 *
 * Exercises the features the other suites DON'T touch: workspaces, communities,
 * catalog, agent tools (labels + quick replies), broadcast lists, live location,
 * incoming webhooks, API keys + the public v1 API, reports, status privacy,
 * scheduled messages, chat lock, and the message actions (edit/react/star/pin/
 * forward/search).
 *
 * Run:  node tests/feature-coverage.mjs   (from /server)
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

const PORT = 5131;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) { console.error('MONGO_URI missing in server/.env'); process.exit(1); }
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_feature$2');
if (TEST_URI === baseUri) { console.error('Could not derive isolated test DB.'); process.exit(1); }

let section = '';
const results = [];
const head = (s) => { section = s; console.log(`\n── ${s} ──`); };
function check(name, cond, detail = '') {
  results.push({ section, name, pass: !!cond });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, { token, body, raw, headers } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
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

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

// This suite deliberately does NOT drop the shared test DB (other suites do), so
// identities must not collide with leftovers. `phone` is unique via a partial
// index, and a collision made signup 409 and crashed the whole run — so the phone
// is drawn from a per-run prefix plus a monotonic counter, and a duplicate is
// retried rather than being allowed to abort everything.
const RUN = String(process.pid % 1000).padStart(3, '0');
let phoneSeq = 0;
const nextPhone = () => `+1${RUN}${String(Date.now() % 10000).padStart(4, '0')}${String(phoneSeq++).padStart(3, '0')}`;

async function makeUser(tag) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const u = {
      name: `FC ${tag}`,
      email: `fc.${tag}.${uniq()}@chatkonect.app`,
      password: 'PasswordF1!',
      phone: nextPhone(),
    };
    const s = await http('POST', '/auth/signup', { body: { ...u, confirmPassword: u.password } });
    if (s.status < 400) {
      const l = await http('POST', '/auth/login', { body: { identifier: u.email, password: u.password } });
      if (!l.data?.token) throw new Error(`login ${tag} failed: ${l.status} ${JSON.stringify(l.data)}`);
      return { ...u, token: l.data.token, id: l.data.user._id, username: l.data.user.username };
    }
    last = s;
    if (s.status !== 409) break; // only duplicates are worth retrying
  }
  throw new Error(`signup ${tag} failed: ${last?.status} ${JSON.stringify(last?.data)}`);
}

/** Make A and B mutual contacts (many features gate on contact-ship). */
async function befriend(A, B) {
  await http('POST', `/contacts/request/${B.id}`, { token: A.token });
  const reqs = await http('GET', '/contacts/requests', { token: B.token });
  const incoming = reqs.data?.incoming || [];
  const r = incoming.find((x) => String(x.from?._id || x.from) === String(A.id));
  if (!r) throw new Error(`no incoming contact request for ${B.email}`);
  const acc = await http('PATCH', `/contacts/request/${r._id}`, { token: B.token, body: { action: 'accept' } });
  if (acc.data?.request?.status !== 'accepted') {
    throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
  }
}

async function main() {
  console.log('\nChatKonect feature-coverage smoke test — isolated DB');
  if (TEST_URI.includes('+srv')) { try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ } }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await startServer();

  const A = await makeUser('a');
  const B = await makeUser('b');
  const C = await makeUser('c');
  await befriend(A, B);
  await befriend(A, C);

  // ─── Contact requests: the action must be explicit ─────────────
  head('Contact requests');
  const E = await makeUser('e');
  await http('POST', `/contacts/request/${E.id}`, { token: A.token });
  const eReqs = await http('GET', '/contacts/requests', { token: E.token });
  const eReq = (eReqs.data?.incoming || [])[0];
  check('request is listed as incoming', !!eReq, `${eReqs.status}`);
  // A malformed body must NOT be taken as "reject" — that outcome is terminal.
  const wrongField = await http('PATCH', `/contacts/request/${eReq?._id}`, { token: E.token, body: { status: 'accepted' } });
  check('malformed action → 400 (not a silent reject)', wrongField.status === 400, `${wrongField.status} ${wrongField.data?.message || ''}`);
  const stillPending = await http('GET', '/contacts/requests', { token: E.token });
  check('request survives a malformed attempt', (stillPending.data?.incoming || []).some((x) => String(x._id) === String(eReq?._id)));
  const okAccept = await http('PATCH', `/contacts/request/${eReq?._id}`, { token: E.token, body: { action: 'accept' } });
  check('explicit accept still works', okAccept.data?.request?.status === 'accepted', `${okAccept.status}`);

  // ─── Workspaces ────────────────────────────────────────────────
  head('Workspaces');
  let ws = await http('GET', '/workspaces/me', { token: A.token });
  check('GET /workspaces/me returns a workspace', ws.status === 200 && !!ws.data?.workspace, `${ws.status}`);
  const wsType = ws.data?.workspace?.type;
  check('new users land in the shared "personal" workspace', wsType === 'personal', `type=${wsType}`);

  const ren = await http('PATCH', '/workspaces/me', { token: A.token, body: { name: 'Renamed WS' } });
  check('renaming the personal workspace is refused', ren.status >= 400, `${ren.status} ${ren.data?.message || ''}`);

  // ─── Communities ───────────────────────────────────────────────
  head('Communities');
  const com = await http('POST', '/communities', { token: A.token, body: { name: 'FC Community', description: 'test' } });
  check('create community (201)', com.status === 201, `${com.status} ${JSON.stringify(com.data?.message || '')}`);
  const community = com.data?.community || {};
  check('community has an inviteCode', !!community.inviteCode);
  check('community has an announcement group', !!community.announcementGroup);

  const joined = await http('POST', `/communities/join/${community.inviteCode}`, { token: B.token });
  check('B joins by invite code', joined.status === 200 || joined.status === 201, `${joined.status} ${joined.data?.message || ''}`);
  const listB = await http('GET', '/communities', { token: B.token });
  check("community appears in B's list", (listB.data?.communities || []).some((c) => String(c._id) === String(community._id)));

  const topic = await http('POST', `/communities/${community._id}/groups`, { token: A.token, body: { name: 'Topic one' } });
  check('admin adds a topic group', topic.status === 200 || topic.status === 201, `${topic.status} ${topic.data?.message || ''}`);
  const topicByB = await http('POST', `/communities/${community._id}/groups`, { token: B.token, body: { name: 'Sneaky' } });
  check('non-admin CANNOT add a topic group', topicByB.status === 403, `${topicByB.status}`);
  const left = await http('POST', `/communities/${community._id}/leave`, { token: B.token });
  check('B leaves the community', left.status === 200, `${left.status}`);

  // ─── Chats + message actions ───────────────────────────────────
  head('Chat + message actions');
  const dc = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
  check('open a direct chat', dc.status === 200 || dc.status === 201, `${dc.status}`);
  const chatId = dc.data?.chat?._id;

  const sent = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'hello world' } });
  check('send a message', sent.status === 201, `${sent.status}`);
  const msgId = sent.data?.message?._id;

  const edited = await http('PATCH', `/messages/${msgId}`, { token: A.token, body: { content: 'hello edited' } });
  check('edit within the window', edited.status === 200 && edited.data?.message?.isEdited === true, `${edited.status}`);
  const reacted = await http('POST', `/messages/${msgId}/react`, { token: B.token, body: { emoji: '👍' } });
  check('react to a message', reacted.status === 200, `${reacted.status}`);
  const starred = await http('POST', `/messages/${msgId}/star`, { token: A.token });
  check('star a message', starred.status === 200, `${starred.status}`);
  const starList = await http('GET', '/messages/starred', { token: A.token });
  check('starred list contains it', (starList.data?.messages || []).some((m) => String(m._id) === String(msgId)));
  // Pins are timed now (1/6/12/24h) and no longer a bodyless toggle — a duration
  // is required, and unpinning is its own DELETE. See tests/pinned-messages.mjs
  // for the full rule set (durations, group admin-only, expiry, the 3-pin cap).
  const pinned = await http('POST', `/messages/${msgId}/pin`, { token: A.token, body: { hours: 6 } });
  check('pin a message for 6 hours', pinned.status === 200, `${pinned.status}`);
  check('pin reports its expiry', !!pinned.data?.pin?.expiresAt);
  const unpinned = await http('DELETE', `/messages/${msgId}/pin`, { token: A.token });
  check('unpin a message', unpinned.status === 200, `${unpinned.status}`);
  const search = await http('GET', `/messages/${chatId}/search?q=edited`, { token: A.token });
  check('in-chat search finds it', (search.data?.messages || []).length > 0, JSON.stringify(search.data)?.slice(0, 120));

  const fwd = await http('POST', '/messages', { token: A.token, body: { chatId, content: 'fwd', forwardedFrom: B.id } });
  check('forwarded message accepted', fwd.status === 201, `${fwd.status}`);

  const disap = await http('PATCH', `/chats/${chatId}/disappearing`, { token: A.token, body: { seconds: 86400 } });
  check('set disappearing timer', disap.status === 200, `${disap.status}`);

  // ─── Chat lock (two-step PIN) ──────────────────────────────────
  head('Chat lock');
  const pinSet = await http('POST', '/auth/two-step/enable', { token: A.token, body: { pin: '1234' } });
  check('enable two-step PIN', pinSet.status === 200, `${pinSet.status} ${pinSet.data?.message || ''}`);
  const lock = await http('POST', `/chats/${chatId}/lock`, { token: A.token });
  check('lock a chat', lock.status === 200, `${lock.status}`);
  const lockedList = await http('POST', '/chats/locked', { token: A.token, body: { pin: '1234' } });
  check('locked chats readable with the PIN', lockedList.status === 200, `${lockedList.status}`);
  const badPin = await http('POST', '/chats/locked', { token: A.token, body: { pin: '9999' } });
  check('wrong PIN refused', badPin.status >= 400, `${badPin.status}`);
  await http('POST', `/chats/${chatId}/unlock`, { token: A.token });

  // ─── Scheduled messages (new feature) ──────────────────────────
  head('Scheduled messages');
  const soon = await http('POST', '/messages/schedule', { token: A.token, body: { chatId, content: 'too soon', sendAt: new Date(Date.now() + 2000).toISOString() } });
  check('refuses a near-term schedule', soon.status >= 400, `${soon.status} ${soon.data?.message || ''}`);
  const sch = await http('POST', '/messages/schedule', { token: A.token, body: { chatId, content: 'later msg', sendAt: new Date(Date.now() + 3600e3).toISOString() } });
  check('schedule a message', sch.status === 201 || sch.status === 200, `${sch.status} ${sch.data?.message || ''}`);
  const schId = sch.data?.scheduled?._id || sch.data?.message?._id;
  const schList = await http('GET', `/messages/scheduled/${chatId}`, { token: A.token });
  check('scheduled list returns it', JSON.stringify(schList.data || {}).includes('later msg'), `${schList.status}`);
  const history = await http('GET', `/messages/${chatId}`, { token: A.token });
  check('pending scheduled msg is NOT in chat history', !(history.data?.messages || []).some((m) => m.content === 'later msg'));
  const cancelled = await http('DELETE', `/messages/scheduled/${schId}`, { token: A.token });
  check('cancel a scheduled message', cancelled.status === 200, `${cancelled.status}`);
  const schByB = await http('POST', '/messages/schedule', { token: B.token, body: { chatId: '507f1f77bcf86cd799439011', content: 'x', sendAt: new Date(Date.now() + 3600e3).toISOString() } });
  check('cannot schedule into a foreign chat', schByB.status >= 400, `${schByB.status}`);

  // ─── Status privacy ────────────────────────────────────────────
  head('Status / stories');
  const st = await http('POST', '/status', { token: A.token, body: { type: 'text', content: 'my story', privacy: { type: 'contacts' } } });
  check('post a status', st.status === 201, `${st.status} ${st.data?.message || ''}`);
  const stId = st.data?.status?._id;
  const feedB = await http('GET', '/status', { token: B.token });
  check('contact B sees it in the feed', JSON.stringify(feedB.data || {}).includes(String(stId)), `${feedB.status}`);

  const D = await makeUser('d'); // NOT a contact of A
  const feedD = await http('GET', '/status', { token: D.token });
  check('non-contact D does NOT see it', !JSON.stringify(feedD.data || {}).includes(String(stId)));

  const excl = await http('POST', '/status', { token: A.token, body: { type: 'text', content: 'hidden from B', privacy: { type: 'except', except: [B.id] } } });
  const exclId = excl.data?.status?._id;
  const feedB2 = await http('GET', '/status', { token: B.token });
  check('"except" audience hides it from B', !JSON.stringify(feedB2.data || {}).includes(String(exclId)), `${excl.status}`);

  await http('POST', `/status/${stId}/view`, { token: B.token });
  const viewers = await http('GET', `/status/${stId}/viewers`, { token: A.token });
  check('owner can read viewers', viewers.status === 200, `${viewers.status}`);
  const viewersByB = await http('GET', `/status/${stId}/viewers`, { token: B.token });
  check('non-owner CANNOT read viewers', viewersByB.status >= 400, `${viewersByB.status}`);

  // ─── Broadcast lists ───────────────────────────────────────────
  head('Broadcast lists');
  const bl = await http('POST', '/broadcasts', { token: A.token, body: { name: 'FC list', recipients: [B.id, C.id] } });
  check('create a broadcast list', bl.status === 201, `${bl.status} ${bl.data?.message || ''}`);
  const blId = bl.data?.list?._id || bl.data?.broadcast?._id;
  const blSend = await http('POST', `/broadcasts/${blId}/send`, { token: A.token, body: { content: 'broadcast hello' } });
  check('send to the list', blSend.status === 200 || blSend.status === 201, `${blSend.status} ${blSend.data?.message || ''}`);
  const bChats = await http('GET', '/chats', { token: B.token });
  check('B received it in a 1:1 chat', JSON.stringify(bChats.data || {}).includes('broadcast hello'), '');
  const blEmpty = await http('POST', `/broadcasts/${blId}/send`, { token: A.token, body: {} });
  check('empty broadcast refused', blEmpty.status >= 400, `${blEmpty.status}`);

  // ─── Live location ─────────────────────────────────────────────
  head('Live location');
  const ll = await http('POST', '/live-location/start', { token: A.token, body: { chatId, lat: 28.6139, lng: 77.209, durationSecs: 600 } });
  check('start live location', ll.status === 201 || ll.status === 200, `${ll.status} ${ll.data?.message || ''}`);
  const llId = ll.data?.message?._id;
  const llUp = await http('POST', `/live-location/${llId}/update`, { token: A.token, body: { lat: 28.62, lng: 77.21 } });
  check('update position', llUp.status === 200, `${llUp.status}`);
  const llActive = await http('GET', `/live-location/${chatId}/active`, { token: A.token });
  check('active shares listed', (llActive.data?.liveLocations || []).length > 0, `${llActive.status} ${JSON.stringify(llActive.data).slice(0, 120)}`);
  const llBad = await http('POST', '/live-location/start', { token: A.token, body: { chatId, lat: 999, lng: 0 } });
  check('out-of-range latitude refused', llBad.status >= 400, `${llBad.status}`);
  const llStop = await http('POST', `/live-location/${llId}/stop`, { token: A.token });
  check('stop sharing', llStop.status === 200, `${llStop.status}`);

  // ─── Incoming webhooks ─────────────────────────────────────────
  head('Incoming webhooks');
  // NOTE: createGroup takes `members`, not `participants`.
  const grp = await http('POST', '/groups', { token: A.token, body: { name: 'Hook group', members: [B.id] } });
  const groupId = grp.data?.chat?._id || grp.data?.group?._id;
  check('create a group', !!groupId, `${grp.status} ${grp.data?.message || ''}`);
  const gMembers = (grp.data?.chat?.participants || []).length;
  check('group has both members', gMembers === 2, `participants=${gMembers}`);
  const wh = await http('POST', '/webhooks', { token: A.token, body: { chatId: groupId, label: 'CI' } });
  check('create a webhook', wh.status === 201, `${wh.status} ${wh.data?.message || ''}`);
  // The token is returned ONCE, embedded in `webhook.url` (/api/hooks/<token>) —
  // it is never echoed again, which is why it isn't a plain `token` field.
  const token = (wh.data?.webhook?.url || '').split('/hooks/')[1];
  check('creation returns the one-time hook URL', !!token, JSON.stringify(wh.data?.webhook || {}).slice(0, 160));
  const ing = await http('POST', `/hooks/${token}`, { body: { text: 'build passed' } });
  check('webhook ingress posts a message', ing.status === 200 || ing.status === 201, `${ing.status} ${ing.data?.message || ''}`);
  const gm = await http('GET', `/messages/${groupId}`, { token: B.token });
  check('the group received it', JSON.stringify(gm.data || {}).includes('build passed'));
  const ingBad = await http('POST', '/hooks/definitely-not-a-real-token', { body: { text: 'nope' } });
  check('unknown webhook token rejected', ingBad.status >= 400, `${ingBad.status}`);
  const whDel = await http('DELETE', `/webhooks/${wh.data?.webhook?.id}`, { token: A.token });
  check('delete the webhook', whDel.status === 200, `${whDel.status}`);

  // ─── Reports ───────────────────────────────────────────────────
  head('Reports');
  const rep = await http('POST', '/reports', { token: B.token, body: { targetType: 'user', targetUser: A.id, reason: 'spam', description: 'test' } });
  check('file a report', rep.status === 201, `${rep.status} ${rep.data?.message || ''}`);
  const repBad = await http('POST', '/reports', { token: B.token, body: { targetType: 'nonsense', reason: 'x' } });
  check('invalid targetType refused', repBad.status >= 400, `${repBad.status}`);

  // ─── API keys + public v1 ──────────────────────────────────────
  head('API keys + public v1 API');
  const key = await http('POST', '/keys', { token: A.token, body: { label: 'k', scopes: ['chat:read'] } });
  check('non-admin creating an API key is refused (adminOnly)', key.status === 403, `${key.status} ${key.data?.message || ''}`);
  const v1NoKey = await http('GET', '/v1/me');
  check('v1 without a key is rejected', v1NoKey.status === 401, `${v1NoKey.status}`);
  const v1BadKey = await http('GET', '/v1/me', { headers: { 'X-API-Key': 'cc_live_bogus' } });
  check('v1 with a bogus key is rejected', v1BadKey.status === 401, `${v1BadKey.status}`);

  // ─── Team workspace: catalog + agent tools ─────────────────────
  head('Team workspace: catalog, labels, quick replies');
  const T = await makeUser('t');
  const mkWs = await http('POST', '/auth/signup', {
    body: {
      name: 'Owner W', email: `fc.w.${uniq()}@chatkonect.app`, password: 'PasswordW1!',
      confirmPassword: 'PasswordW1!', phone: `+1${String(7000000000n + BigInt(Math.floor(Math.random() * 9e8)))}`,
      accountType: 'workspace', workspaceName: 'FC Team',
    },
  });
  check('signup can create a TEAM workspace', mkWs.status === 201, `${mkWs.status} ${mkWs.data?.message || ''}`);
  const W = mkWs.data?.user ? { token: mkWs.data.token, id: mkWs.data.user._id } : null;
  const wws = W ? await http('GET', '/workspaces/me', { token: W.token }) : { data: {} };
  check('owner gets a team workspace', wws.data?.workspace?.type === 'team', `type=${wws.data?.workspace?.type}`);

  if (W) {
    const prod = await http('POST', '/catalog', { token: W.token, body: { name: 'Widget', price: 999, currency: 'USD', description: 'A widget' } });
    check('workspace owner creates a product', prod.status === 201, `${prod.status} ${prod.data?.message || ''}`);
    const mine = await http('GET', '/catalog/mine', { token: W.token });
    check('catalog lists it', (mine.data?.products || []).length > 0, `${mine.status}`);
    const prodByA = await http('POST', '/catalog', { token: A.token, body: { name: 'Nope' } });
    check('personal-workspace user cannot create products', prodByA.status >= 400, `${prodByA.status}`);

    const lab = await http('POST', '/agent/labels', { token: W.token, body: { name: 'New customer', color: '#6366f1' } });
    check('create a label', lab.status === 201, `${lab.status} ${lab.data?.message || ''}`);
    const labDup = await http('POST', '/agent/labels', { token: W.token, body: { name: 'New customer' } });
    check('duplicate label name refused', labDup.status >= 400, `${labDup.status}`);
    const qr = await http('POST', '/agent/quick-replies', { token: W.token, body: { shortcut: '/hi', text: 'Hello there!' } });
    check('create a quick reply', qr.status === 201, `${qr.status} ${qr.data?.message || ''}`);
    const qrList = await http('GET', '/agent/quick-replies', { token: W.token });
    check('quick replies list', (qrList.data?.quickReplies || qrList.data?.replies || []).length > 0, `${qrList.status}`);
    const qrStrip = await http('POST', '/agent/quick-replies', { token: W.token, body: { shortcut: '///bye', text: 'Bye' } });
    check('leading slashes stripped from shortcut', /^bye$/.test(qrStrip.data?.quickReply?.shortcut || qrStrip.data?.reply?.shortcut || ''), JSON.stringify(qrStrip.data)?.slice(0, 140));
  }

  // ─── Data export + account deletion ────────────────────────────
  head('Privacy: export + delete account');
  const exp = await http('GET', '/users/me/export', { token: C.token });
  check('data export returns the user bundle', exp.status === 200 && !!exp.data, `${exp.status}`);
  const del = await http('DELETE', '/users/me', { token: C.token, body: { password: C.password } });
  check('delete own account', del.status === 200, `${del.status} ${del.data?.message || ''}`);
  const after = await http('GET', '/auth/me', { token: C.token });
  check('token is dead after deletion', after.status === 401, `${after.status}`);

  // ─── Scheduled message DISPATCH (the dispatcher loop) ──────────
  // The API refuses a near-term sendAt, so a due row is inserted directly and we
  // wait for the background dispatcher to claim and deliver it. This is the only
  // check that proves the feature actually SENDS, not just that it queues.
  head('Scheduled message dispatch');
  const { default: ScheduledMessage } = await import('../models/ScheduledMessage.js');
  const due = await ScheduledMessage.create({
    chat: chatId, sender: A.id, type: 'text',
    content: 'dispatched by the loop', sendAt: new Date(Date.now() - 5000), status: 'pending',
  });
  let delivered = null;
  for (let i = 0; i < 70; i += 1) {          // dispatcher ticks every 30s; allow ~105s under load
    await sleep(1500);
    const h2 = await http('GET', `/messages/${chatId}`, { token: A.token });
    delivered = (h2.data?.messages || []).find((m) => m.content === 'dispatched by the loop');
    if (delivered) break;
  }
  check('due scheduled message is delivered into the chat', !!delivered, 'not delivered within 60s');
  const row = await ScheduledMessage.findById(due._id);
  check("row is marked 'sent'", row?.status === 'sent', `status=${row?.status} error=${row?.error || ''}`);
  check('row links back to the real message', !!row?.sentMessage);

  // ─── Wrap up ───────────────────────────────────────────────────
  if (proc && !proc.killed) proc.kill();
  await sleep(300);
  await mongoose.disconnect();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ✗ [${f.section}] ${f.name}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nHARNESS ERROR:', e.message);
  if (proc && !proc.killed) proc.kill();
  try { await mongoose.disconnect(); } catch { /* noop */ }
  process.exit(1);
});

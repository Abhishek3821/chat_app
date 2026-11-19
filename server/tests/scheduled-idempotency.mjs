import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const PORT = 5123;
const API = `http://127.0.0.1:${PORT}/api`;

const baseUri = process.env.MONGO_URI || '';
if (!baseUri) {
  console.error('MONGO_URI missing in server/.env — cannot run.');
  process.exit(1);
}
const TEST_URI = baseUri.replace(/\/([^/?]*)(\?|$)/, '/chatconnect_t_sched$2');
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

/*
 * Scheduled sends are idempotent across a crash.
 *
 * The dispatcher claims a row ('pending' → 'sending'), creates the message, then
 * marks the row 'sent'. A process that died between those last two steps left
 * the row 'sending'; after CLAIM_STALE_MS any instance reclaimed it and sent the
 * message a SECOND time. The message id is now fixed at first claim and reused.
 */
const oid = (id) => new mongoose.Types.ObjectId(String(id));

(async () => {
  if (TEST_URI.includes('+srv')) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* noop */ }
  }
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 20000 });
  await mongoose.connection.dropDatabase();
  const db = mongoose.connection;
  const { default: Chat } = await import('../models/Chat.js');
  const { default: User } = await import('../models/User.js');
  const { default: ScheduledMessage } = await import('../models/ScheduledMessage.js');
  const { startScheduledDispatcher, stopScheduledDispatcher } = await import('../utils/scheduledDispatcher.js');

  const a = await User.create({ name: 'Sched A', username: `scha${Date.now()}`, email: `scha${Date.now()}@test.local`, password: 'Passw0rd!23' });
  const b = await User.create({ name: 'Sched B', username: `schb${Date.now()}`, email: `schb${Date.now()}@test.local`, password: 'Passw0rd!23' });
  const chat = await Chat.create({ isGroup: true, name: 'Sched', participants: [{ user: a._id, role: 'owner' }, { user: b._id }] });
  const past = new Date(Date.now() - 60_000);

  section('A crash after the message was created');
  // What a dead process leaves behind: row stuck in 'sending' (stale claim), its
  // message already in the chat.
  const preId = new mongoose.Types.ObjectId();
  await db.collection('messages').insertOne({ _id: preId, chat: chat._id, sender: a._id, type: 'text', content: 'crashed send', isDeleted: false, readBy: [], deliveredTo: [], deletedFor: [], reactions: [], createdAt: past, updatedAt: past });
  const crashed = await ScheduledMessage.create({ chat: chat._id, sender: a._id, type: 'text', content: 'crashed send', sendAt: past, status: 'sending', claimedAt: new Date(Date.now() - 10 * 60_000), messageId: preId });

  section('A normal due row');
  const normal = await ScheduledMessage.create({ chat: chat._id, sender: a._id, type: 'text', content: 'on time', sendAt: past, status: 'pending' });

  startScheduledDispatcher(); // runs a tick immediately now (no 30s wait)
  await sleep(4000);
  stopScheduledDispatcher();

  const copies = await db.collection('messages').countDocuments({ chat: chat._id, content: 'crashed send' });
  check('the crashed send is NOT delivered a second time', copies === 1, `${copies} copies`);
  const c = await ScheduledMessage.findById(crashed._id).lean();
  check('…and its row is closed out as sent, pointing at the original', c.status === 'sent' && String(c.sentMessage) === String(preId), `${c.status} ${c.sentMessage}`);
  const n = await ScheduledMessage.findById(normal._id).lean();
  const delivered = await db.collection('messages').findOne({ chat: chat._id, content: 'on time' });
  check('a normal due row is sent on the first tick after start', n.status === 'sent' && Boolean(delivered), n.status);
  check('…with the message id it was assigned at claim', String(delivered?._id) === String(n.messageId) && String(n.sentMessage) === String(n.messageId));
  const preview = await db.collection('chats').findOne({ _id: chat._id });
  check('the chat preview points at the newest message', String(preview.lastMessage) === String(delivered?._id), String(preview.lastMessage));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL', err);
  process.exit(1);
});

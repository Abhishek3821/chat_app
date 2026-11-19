import mongoose from 'mongoose';
import Message from '../models/Message.js';
import ChatRead from '../models/ChatRead.js';

/**
 * Read state, built on a per-user watermark (models/ChatRead.js).
 *
 *   unread(chat, me) = messages in `chat` from someone else, created after my
 *                      watermark, not deleted (for everyone, or for me)
 *
 * Chats with no watermark yet (data from before this existed) fall back to the
 * old exact `readBy` count; when that comes out at zero a watermark is written,
 * so every chat moves onto the cheap path the first time it is fully read —
 * no migration needed.
 */

const toId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

/* `readBy` receipts are stamped only on messages after the previous watermark
   (minus this margin, to catch a message created just before a mark-read but
   committed just after it). Everything older was stamped by earlier reads. */
const RECEIPT_OVERLAP_MS = 60_000;

/**
 * Unread counts for many chats in at most two aggregations.
 * @param {Array<{_id, participants?: Array<{user, joinedAt?}>}>} chats lean chats (participants may be populated)
 * @returns {Promise<Map<string, number>>}
 */
export async function unreadCountsFor(chats, userId) {
  const counts = new Map();
  if (!chats.length) return counts;
  const me = toId(userId);
  const ids = chats.map((c) => c._id);
  const marks = new Map(
    (await ChatRead.find({ user: me, chat: { $in: ids } }).select('chat lastReadAt').lean()).map((r) => [String(r.chat), r.lastReadAt])
  );
  const base = { sender: { $ne: me }, isDeleted: false, deletedFor: { $ne: me } };

  const ranged = [];
  const legacy = [];
  for (const chat of chats) {
    const mark = marks.get(String(chat._id));
    if (mark) {
      ranged.push({ chat: chat._id, createdAt: { $gt: mark } });
    } else {
      // A member who joined a group later never had its earlier history "unread".
      const mine = (chat.participants || []).find((p) => String(p.user?._id || p.user) === String(me));
      legacy.push(mine?.joinedAt ? { chat: chat._id, createdAt: { $gt: new Date(mine.joinedAt) } } : { chat: chat._id });
    }
  }

  const tally = async (branches, extra = {}) => {
    if (!branches.length) return;
    const rows = await Message.aggregate([
      { $match: { ...base, ...extra, $or: branches } },
      { $group: { _id: '$chat', count: { $sum: 1 } } },
    ]);
    rows.forEach((r) => counts.set(String(r._id), r.count));
  };
  await Promise.all([tally(ranged), tally(legacy, { 'readBy.user': { $ne: me } })]);

  // Legacy chats that turned out fully read: start their watermark now, so the
  // next load takes the cheap path. $setOnInsert never moves an existing mark.
  const settled = legacy.map((b) => b.chat).filter((id) => !counts.get(String(id)));
  if (settled.length) {
    const now = new Date();
    ChatRead.bulkWrite(
      settled.map((chat) => ({
        updateOne: { filter: { user: me, chat }, update: { $setOnInsert: { lastReadAt: now } }, upsert: true },
      })),
      { ordered: false }
    ).catch(() => {});
  }
  return counts;
}

/**
 * The user has read everything in the chat (opened it / scrolled to the end).
 * Moves their watermark to now and stamps `readBy` receipts on just the newly
 * read messages. Caller must have verified membership.
 * @returns {Promise<number>} how many messages got a new receipt
 */
export async function markChatRead(chatId, userId) {
  const me = toId(userId);
  const chat = toId(chatId);
  const now = new Date();
  // One round trip: advance the watermark ($max — never backwards) and get the
  // previous one back to bound the receipt update below.
  const previous = await ChatRead.findOneAndUpdate(
    { user: me, chat },
    { $max: { lastReadAt: now } },
    { upsert: true, new: false, projection: { lastReadAt: 1 } }
  ).lean();

  const filter = { chat, sender: { $ne: me }, 'readBy.user': { $ne: me } };
  if (previous?.lastReadAt) filter.createdAt = { $gt: new Date(new Date(previous.lastReadAt).getTime() - RECEIPT_OVERLAP_MS) };
  const r = await Message.updateMany(filter, { $push: { readBy: { user: me, at: now } } });
  return r.modifiedCount;
}

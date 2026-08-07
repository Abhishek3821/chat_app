import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import { emitToUser } from '../socket/index.js';
import { cacheGetJSON, cacheSetJSON, cacheDel } from './cache.js';
import { memoGet, memoSet, memoDel } from './memo.js';

// Send at most one "away" auto-reply per chat per hour, so a chatty customer
// doesn't get spammed with the same out-of-hours notice on every line.
const AWAY_COOLDOWN_MS = 60 * 60 * 1000;

// How long to remember that a recipient has no auto-replies configured. Short
// enough that enabling them takes effect promptly even if an invalidation is
// missed; long enough to absorb a busy conversation.
const NO_AUTOREPLY_TTL = 300; // seconds
const noAutoReplyKey = (userId) => `ar:none:${userId}`;

/**
 * Forget the cached "no auto-replies" answer for a workspace's members. Call
 * whenever a workspace's autoReplies config changes, otherwise turning them ON
 * would appear to do nothing for up to NO_AUTOREPLY_TTL.
 */
export async function invalidateAutoReplyCache(workspaceId) {
  if (!workspaceId) return;
  const members = await User.find({ workspace: workspaceId }).select('_id').lean();
  const keys = members.map((m) => noAutoReplyKey(m._id));
  if (keys.length) {
    memoDel(...keys);
    await cacheDel(...keys);
  }
}

/** Is the current local hour outside the business's [startHour, endHour) window? */
function isOutsideHours(away) {
  const h = new Date().getHours();
  const start = Number.isInteger(away.startHour) ? away.startHour : 9;
  const end = Number.isInteger(away.endHour) ? away.endHour : 18;
  if (start === end) return false; // treat as always-open (24h)
  const open = start < end ? h >= start && h < end : h >= start || h < end; // handles overnight windows
  return !open;
}

async function sendAuto(chat, fromUserId, text, kind) {
  let message = await Message.create({
    chat: chat._id,
    sender: fromUserId,
    type: 'text',
    content: text.slice(0, 1000),
    autoReplyKind: kind,
    deliveredTo: [fromUserId],
    readBy: [{ user: fromUserId, at: new Date() }],
  });
  chat.lastMessage = message._id;
  await chat.save();
  message = await Message.findById(message._id).populate('sender', 'name username avatar');
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId: String(chat._id), message });
    if (String(p.user) !== String(fromUserId)) emitToUser(String(p.user), 'chat-updated', { chatId: String(chat._id) });
  }
}

/**
 * If an inbound message landed in a 1:1 chat whose OTHER side is a business with
 * auto-replies enabled (and the sender isn't part of that business), fire the
 * appropriate greeting/away reply from the business-side participant. Runs off
 * the request path (via the queue) and is best-effort — never throws upstream.
 */
export async function maybeAutoReply({ chatId, senderId, otherIds }) {
  // Fast path: the caller told us who the recipient is, so a cached "this person
  // has no auto-replies" answer settles it without touching Mongo at all.
  if (Array.isArray(otherIds) && otherIds.length === 1) {
    const k = noAutoReplyKey(otherIds[0]);
    if (memoGet(k) || (await cacheGetJSON(k))) return;
  }

  // Almost every direct message is to someone with no auto-replies at all, and
  // proving that used to cost three queries (Chat + User + Workspace) on EVERY
  // send. A negative result is cached per recipient, so the common case settles
  // after the chat lookup alone. Bounded by NO_AUTOREPLY_TTL and invalidated
  // explicitly when a workspace's autoReplies change.
  //
  // The chat is re-read rather than handed in: this runs through `enqueue`, whose
  // payload must stay JSON-serialisable for the BullMQ path, and having the
  // queued and inline paths load different state is the divergence this file's
  // single-code-path design exists to avoid.
  // Loaded whole, not projected: sendAuto() mutates and saves this document.
  const chat = await Chat.findById(chatId);
  if (!chat || chat.isGroup) return;

  const others = chat.participants.filter((p) => String(p.user) !== String(senderId));
  if (others.length !== 1) return; // only classic 1:1
  const businessSideId = others[0].user;

  const noneKey = noAutoReplyKey(businessSideId);
  if (memoGet(noneKey) || (await cacheGetJSON(noneKey))) return;
  const markNone = () => {
    memoSet(noneKey, 1, NO_AUTOREPLY_TTL); // works with Redis off (the default)
    return cacheSetJSON(noneKey, 1, NO_AUTOREPLY_TTL);
  };

  const businessUser = await User.findById(businessSideId).select('workspace');
  if (!businessUser?.workspace) return markNone();
  const ws = await Workspace.findById(businessUser.workspace).select('type autoReplies');
  if (!ws || ws.type === 'personal') return markNone();
  const ar = ws.autoReplies || {};
  if (!ar.away?.enabled && !ar.greeting?.enabled) return markNone();

  // Don't auto-reply to the business's own agents (internal chat). Only reached
  // once a real auto-reply config exists, so this is off the common path.
  const sender = await User.findById(senderId).select('workspace');
  if (sender?.workspace && String(sender.workspace) === String(ws._id)) return;

  // Away takes priority when out of hours (throttled per chat).
  if (ar.away?.enabled && ar.away.text && isOutsideHours(ar.away)) {
    const lastAway = await Message.findOne({ chat: chatId, sender: businessSideId, autoReplyKind: 'away' })
      .sort({ createdAt: -1 })
      .select('createdAt');
    if (!lastAway || Date.now() - new Date(lastAway.createdAt).getTime() > AWAY_COOLDOWN_MS) {
      await sendAuto(chat, businessSideId, ar.away.text, 'away');
    }
    return;
  }

  // Greeting fires once per chat (first contact, before any prior auto-reply).
  if (ar.greeting?.enabled && ar.greeting.text) {
    const already = await Message.exists({ chat: chatId, sender: businessSideId, autoReplyKind: { $exists: true, $ne: null } });
    if (!already) await sendAuto(chat, businessSideId, ar.greeting.text, 'greeting');
  }
}

import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import { emitToUser } from '../socket/index.js';

// Send at most one "away" auto-reply per chat per hour, so a chatty customer
// doesn't get spammed with the same out-of-hours notice on every line.
const AWAY_COOLDOWN_MS = 60 * 60 * 1000;

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
export async function maybeAutoReply({ chatId, senderId }) {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.isGroup) return;

  const others = chat.participants.filter((p) => String(p.user) !== String(senderId));
  if (others.length !== 1) return; // only classic 1:1
  const businessSideId = others[0].user;

  const businessUser = await User.findById(businessSideId).select('workspace');
  if (!businessUser?.workspace) return;
  const ws = await Workspace.findById(businessUser.workspace).select('type autoReplies');
  if (!ws || ws.type === 'personal') return;
  const ar = ws.autoReplies || {};
  if (!ar.away?.enabled && !ar.greeting?.enabled) return;

  // Don't auto-reply to the business's own agents (internal chat).
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

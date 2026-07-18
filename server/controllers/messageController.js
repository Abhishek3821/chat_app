import Message from '../models/Message.js';
import Chat from '../models/Chat.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat, emitToUser } from '../socket/index.js';
import { enqueue } from '../utils/queue.js';
import { notifyUser } from '../utils/notify.js';
import { groupCan, PERMISSIONS } from '../utils/rbac.js';

const SENDER_FIELDS = 'name username avatar';
// Types a client may set (everything except 'system', which is server-generated).
const USER_MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'voice', 'document', 'location'];
const MAX_CONTENT = 10_000;
const MAX_ATTACHMENTS = 20;

/** Keep only well-formed attachments whose URL is our own upload or an https URL
 *  (blocks data:/javascript:/relative-path injection that a client could auto-load). */
function sanitizeAttachments(attachments) {
  if (attachments === undefined) return undefined;
  if (!Array.isArray(attachments)) throw new ApiError(400, 'attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) throw new ApiError(400, `At most ${MAX_ATTACHMENTS} attachments per message.`);
  return attachments
    .filter((a) => a && typeof a.url === 'string' && (a.url.startsWith('/uploads/') || /^https:\/\//i.test(a.url)))
    .map((a) => ({ url: a.url, name: a.name, size: a.size, mime: a.mime, width: a.width, height: a.height, duration: a.duration }));
}

async function assertMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw new ApiError(404, 'Chat not found.');
  const isMember = chat.participants.some((p) => String(p.user) === String(userId));
  if (!isMember) throw new ApiError(403, 'You are not a participant of this chat.');
  return chat;
}

function populateMessage(query) {
  return query
    .populate('sender', SENDER_FIELDS)
    .populate('reactions.user', SENDER_FIELDS)
    .populate({ path: 'replyTo', populate: { path: 'sender', select: SENDER_FIELDS } });
}

// GET /api/messages/:chatId?before=&limit=
export const getMessages = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const filter = { chat: req.params.chatId, deletedFor: { $ne: req.user._id } };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };

  const messages = await populateMessage(Message.find(filter).sort({ createdAt: -1 }).limit(limit));
  res.json({ success: true, messages: messages.reverse() });
});

// POST /api/messages  — send a message (persist + realtime broadcast)
export const sendMessage = asyncHandler(async (req, res) => {
  const { chatId, content = '', type = 'text', replyTo, location, mentions, forwardedFrom } = req.body;
  const chat = await assertMember(chatId, req.user._id);

  if (chat.isGroup && chat.messagingPolicy === 'admins') {
    const me = chat.participants.find((p) => String(p.user) === String(req.user._id));
    if (!me || !groupCan(me.role, PERMISSIONS.GROUP_MANAGE)) throw new ApiError(403, 'Only admins can send messages in this group.');
  }

  // Validate client-supplied fields (don't trust type/attachments/content blindly).
  if (!USER_MESSAGE_TYPES.includes(type)) throw new ApiError(400, 'Invalid message type.');
  if (typeof content !== 'string' || content.length > MAX_CONTENT) {
    throw new ApiError(400, `Message text must be a string under ${MAX_CONTENT} characters.`);
  }
  const attachments = sanitizeAttachments(req.body.attachments);
  const safeMentions = Array.isArray(mentions) ? mentions.slice(0, 100) : undefined;

  if (!content && (!attachments || attachments.length === 0) && !location) {
    throw new ApiError(400, 'Message cannot be empty.');
  }

  // Disappearing messages: stamp an expiry so the TTL index self-deletes it.
  const expiresAt = chat.disappearingSeconds > 0 ? new Date(Date.now() + chat.disappearingSeconds * 1000) : undefined;
  // View-once only applies to media.
  const viewOnce = Boolean(req.body.viewOnce) && (type === 'image' || type === 'video');

  let message = await Message.create({
    chat: chatId,
    sender: req.user._id,
    type,
    content,
    attachments,
    location,
    replyTo: replyTo || undefined,
    mentions: safeMentions,
    forwardedFrom: forwardedFrom || undefined,
    expiresAt,
    viewOnce,
    deliveredTo: [req.user._id],
    readBy: [{ user: req.user._id, at: new Date() }],
  });

  chat.lastMessage = message._id;
  await chat.save();

  message = await populateMessage(Message.findById(message._id));

  // Realtime fan-out. Deliver to every participant's PERSONAL room (not just the
  // chat room) so online users receive it instantly even if they don't have this
  // chat open — this is what drives delivered ticks and low-latency delivery.
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId, message });
  }
  const preview = content?.slice(0, 120) || `Sent ${type}`;
  for (const p of chat.participants) {
    const uid = String(p.user);
    if (uid === String(req.user._id)) continue;
    emitToUser(uid, 'chat-updated', { chatId });
    // Off the request path (BullMQ when Redis is set, else inline): persist the
    // in-app notification AND fire a Web Push so recipients with no live socket
    // still get pinged.
    notifyUser(uid, {
      from: req.user._id,
      type: chat.isGroup ? 'group_message' : 'message',
      title: chat.isGroup ? chat.name || 'New group message' : req.user.name,
      body: chat.isGroup ? `${req.user.name}: ${preview}` : preview,
      tag: `chat:${chatId}`,
      url: `/?chat=${chatId}`,
      data: { chatId },
    });
  }

  // WhatsApp-Business auto-reply (greeting/away) for inbound customer messages,
  // off the request path. No-op unless the other side is a business with it on.
  if (!chat.isGroup) enqueue('automsg.maybe', { chatId, senderId: String(req.user._id) });

  res.status(201).json({ success: true, message });
});

// PATCH /api/messages/:id  — edit
export const editMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertMember(message.chat, req.user._id);
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own messages.');

  // Bound the edit like a send — otherwise an edit could balloon a message far
  // past the send-time cap (limited only by the global body size).
  if (req.body.content !== undefined) {
    if (typeof req.body.content !== 'string' || req.body.content.length > MAX_CONTENT) {
      throw new ApiError(400, `Message text must be a string under ${MAX_CONTENT} characters.`);
    }
    message.content = req.body.content;
  }
  message.isEdited = true;
  message.editedAt = new Date();
  await message.save();

  const populated = await populateMessage(Message.findById(message._id));
  emitToChat(String(message.chat), 'message-edited', { chatId: String(message.chat), message: populated });
  res.json({ success: true, message: populated });
});

// DELETE /api/messages/:id?scope=me|everyone
export const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertMember(message.chat, req.user._id);
  const scope = req.query.scope || 'me';

  if (scope === 'everyone') {
    if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only delete your own messages for everyone.');
    message.isDeleted = true;
    message.content = '';
    message.attachments = [];
    await message.save();
    emitToChat(String(message.chat), 'message-deleted', { chatId: String(message.chat), messageId: message._id, scope });
  } else {
    await Message.findByIdAndUpdate(message._id, { $addToSet: { deletedFor: req.user._id } });
  }
  res.json({ success: true });
});

// POST /api/messages/:id/react  { emoji }
export const reactToMessage = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertMember(message.chat, req.user._id);

  const existing = message.reactions.find((r) => String(r.user) === String(req.user._id));
  if (existing && existing.emoji === emoji) {
    message.reactions = message.reactions.filter((r) => String(r.user) !== String(req.user._id));
  } else if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ user: req.user._id, emoji });
  }
  await message.save();

  const populated = await populateMessage(Message.findById(message._id));
  emitToChat(String(message.chat), 'message-reaction', {
    chatId: String(message.chat),
    messageId: String(message._id),
    reactions: populated.reactions,
  });
  res.json({ success: true, message: populated });
});

// POST /api/messages/:id/star  (toggle)
export const toggleStar = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertMember(message.chat, req.user._id);
  const starred = message.starredBy.some((u) => String(u) === String(req.user._id));
  await Message.findByIdAndUpdate(message._id, starred ? { $pull: { starredBy: req.user._id } } : { $addToSet: { starredBy: req.user._id } });
  res.json({ success: true, starred: !starred });
});

// GET /api/messages/starred
export const getStarred = asyncHandler(async (req, res) => {
  const messages = await populateMessage(Message.find({ starredBy: req.user._id }).sort({ createdAt: -1 }).limit(100));
  res.json({ success: true, messages });
});

// POST /api/messages/read  { chatId }
export const markRead = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  await assertMember(chatId, req.user._id);
  await Message.updateMany(
    { chat: chatId, sender: { $ne: req.user._id }, 'readBy.user': { $ne: req.user._id } },
    { $push: { readBy: { user: req.user._id, at: new Date() } } }
  );
  // Respect the reader's read-receipt privacy: don't reveal read state if off.
  if (req.user.privacy?.readReceipts !== false) {
    emitToChat(chatId, 'message-read', { chatId, userId: String(req.user._id) });
  }
  res.json({ success: true });
});

// GET /api/messages/:chatId/search?q=
export const searchMessages = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, messages: [] });
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const messages = await populateMessage(
    Message.find({ chat: req.params.chatId, content: rx, isDeleted: false, deletedFor: { $ne: req.user._id } })
      .sort({ createdAt: -1 })
      .limit(50)
  );
  res.json({ success: true, messages });
});

// POST /api/messages/:id/viewed  — consume a view-once message.
// Each recipient may see it once; the media is purged from storage/DB once every
// recipient has opened it. The client hides it for anyone already in viewedBy.
export const markViewed = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  const chat = await assertMember(message.chat, req.user._id);
  const uid = String(req.user._id);
  if (!message.viewOnce || String(message.sender) === uid) return res.json({ success: true });

  if (!message.viewedBy.some((v) => String(v) === uid)) {
    message.viewedBy.push(req.user._id);
    const recipientCount = chat.participants.filter((p) => String(p.user) !== String(message.sender)).length;
    if (message.viewedBy.length >= recipientCount) {
      message.attachments = []; // everyone has seen it → purge the media
      message.content = '';
    }
    await message.save();
    const populated = await populateMessage(Message.findById(message._id));
    emitToChat(String(message.chat), 'message-updated', { chatId: String(message.chat), message: populated });
  }
  res.json({ success: true });
});

// POST /api/messages/poll  { chatId, question, options[], multi }
export const createPoll = asyncHandler(async (req, res) => {
  const { chatId, question, options, multi } = req.body;
  const chat = await assertMember(chatId, req.user._id);

  if (chat.isGroup && chat.messagingPolicy === 'admins') {
    const me = chat.participants.find((p) => String(p.user) === String(req.user._id));
    if (!me || !groupCan(me.role, PERMISSIONS.GROUP_MANAGE)) throw new ApiError(403, 'Only admins can post in this group.');
  }

  const q = typeof question === 'string' ? question.trim() : '';
  const opts = Array.isArray(options)
    ? [...new Set(options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 12)
    : [];
  if (!q) throw new ApiError(400, 'A poll needs a question.');
  if (q.length > 300) throw new ApiError(400, 'Poll question is too long (max 300 characters).');
  if (opts.length < 2) throw new ApiError(400, 'A poll needs at least two options.');
  if (opts.some((o) => o.length > 150)) throw new ApiError(400, 'Poll options must be under 150 characters.');

  const expiresAt = chat.disappearingSeconds > 0 ? new Date(Date.now() + chat.disappearingSeconds * 1000) : undefined;
  let message = await Message.create({
    chat: chatId,
    sender: req.user._id,
    type: 'poll',
    poll: { question: q, options: opts.map((text) => ({ text, votes: [] })), multi: Boolean(multi), closed: false },
    expiresAt,
    deliveredTo: [req.user._id],
    readBy: [{ user: req.user._id, at: new Date() }],
  });

  chat.lastMessage = message._id;
  await chat.save();

  message = await populateMessage(Message.findById(message._id));
  for (const p of chat.participants) emitToUser(String(p.user), 'receive-message', { chatId, message });
  for (const p of chat.participants) {
    if (String(p.user) !== String(req.user._id)) emitToUser(String(p.user), 'chat-updated', { chatId });
  }
  res.status(201).json({ success: true, message });
});

// POST /api/messages/:id/vote  { optionIndex }
export const votePoll = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message || message.type !== 'poll' || !message.poll) throw new ApiError(404, 'Poll not found.');
  await assertMember(message.chat, req.user._id);
  if (message.poll.closed) throw new ApiError(400, 'This poll is closed.');

  const idx = Number(req.body.optionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= message.poll.options.length) {
    throw new ApiError(400, 'Invalid poll option.');
  }

  const uid = String(req.user._id);
  const votedThis = message.poll.options[idx].votes.some((v) => String(v) === uid);
  message.poll.options.forEach((opt, i) => {
    if (message.poll.multi) {
      // Toggle only the clicked option; leave the others as-is.
      if (i === idx) {
        opt.votes = votedThis ? opt.votes.filter((v) => String(v) !== uid) : [...opt.votes, req.user._id];
      }
    } else {
      // Single choice: my vote lives on at most one option (re-click = clear).
      opt.votes = opt.votes.filter((v) => String(v) !== uid);
      if (i === idx && !votedThis) opt.votes.push(req.user._id);
    }
  });

  await message.save();
  const populated = await populateMessage(Message.findById(message._id));
  emitToChat(String(message.chat), 'message-updated', { chatId: String(message.chat), message: populated });
  res.json({ success: true, message: populated });
});

// POST /api/messages/:id/pin  (toggle at chat level)
export const togglePin = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  const chat = await assertMember(message.chat, req.user._id);
  const pinned = chat.pinnedMessages.some((m) => String(m) === String(message._id));
  await Chat.findByIdAndUpdate(chat._id, pinned ? { $pull: { pinnedMessages: message._id } } : { $addToSet: { pinnedMessages: message._id } });
  emitToChat(String(chat._id), 'message-pinned', { chatId: String(chat._id), messageId: String(message._id), pinned: !pinned });
  res.json({ success: true, pinned: !pinned });
});

import Message from '../models/Message.js';
import Chat from '../models/Chat.js';
import Notification from '../models/Notification.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat, emitToUser } from '../socket/index.js';

const SENDER_FIELDS = 'name username avatar';

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
  const { chatId, content = '', type = 'text', replyTo, attachments, location, mentions, forwardedFrom } = req.body;
  const chat = await assertMember(chatId, req.user._id);

  if (chat.isGroup && chat.messagingPolicy === 'admins') {
    const me = chat.participants.find((p) => String(p.user) === String(req.user._id));
    if (!me || me.role === 'member') throw new ApiError(403, 'Only admins can send messages in this group.');
  }

  if (!content && (!attachments || attachments.length === 0) && !location) {
    throw new ApiError(400, 'Message cannot be empty.');
  }

  let message = await Message.create({
    chat: chatId,
    sender: req.user._id,
    type,
    content,
    attachments,
    location,
    replyTo: replyTo || undefined,
    mentions,
    forwardedFrom: forwardedFrom || undefined,
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
  for (const p of chat.participants) {
    const uid = String(p.user);
    if (uid === String(req.user._id)) continue;
    emitToUser(uid, 'chat-updated', { chatId });
    // Persist a notification (best-effort).
    Notification.create({
      user: uid,
      from: req.user._id,
      type: chat.isGroup ? 'group_message' : 'message',
      title: req.user.name,
      body: content?.slice(0, 120) || `Sent ${type}`,
      data: { chatId },
    }).catch(() => {});
  }

  res.status(201).json({ success: true, message });
});

// PATCH /api/messages/:id  — edit
export const editMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertMember(message.chat, req.user._id);
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own messages.');

  message.content = req.body.content ?? message.content;
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
  emitToChat(chatId, 'message-read', { chatId, userId: String(req.user._id) });
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

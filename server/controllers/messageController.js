import Message from '../models/Message.js';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat, emitToUser } from '../socket/index.js';
import { enqueue } from '../utils/queue.js';
import { notifyUser } from '../utils/notify.js';
import { groupCan, PERMISSIONS } from '../utils/rbac.js';
import { invalidateChatListCache } from '../utils/chatCache.js';
import {
  assertValidDuration,
  assertMayPin,
  canPin,
  canUnpin,
  activePins,
  populatedPins,
  serializePin,
  MAX_PINS_PER_CHAT,
} from '../utils/pins.js';

const SENDER_FIELDS = 'name username avatar';
// Types a client may set (everything except 'system', which is server-generated).
// 'videoNote' is the Telegram-style round clip — a distinct type rather than a
// flag on 'video' so the bubble can render it circular without inspecting mime.
export const USER_MESSAGE_TYPES = ['text', 'image', 'video', 'videoNote', 'audio', 'voice', 'document', 'location'];
const MAX_CONTENT = 10_000;
const MAX_ATTACHMENTS = 20;
// Editing is only allowed shortly after sending (WhatsApp-style window).
const EDIT_WINDOW_MS = 5 * 60 * 1000;
// "Delete for everyone" is only allowed shortly after sending — past this, the
// sender can still delete it for themselves, just not retract it for the chat.
const DELETE_EVERYONE_WINDOW_MS = 5 * 60 * 1000;

/** Keep only well-formed attachments whose URL is our own upload or an https URL
 *  (blocks data:/javascript:/relative-path injection that a client could auto-load). */
function sanitizeAttachments(attachments) {
  if (attachments === undefined) return undefined;
  if (!Array.isArray(attachments)) throw new ApiError(400, 'attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) throw new ApiError(400, `At most ${MAX_ATTACHMENTS} attachments per message.`);
  return attachments
    .filter((a) => a && typeof a.url === 'string' && (a.url.startsWith('/uploads/') || /^https:\/\//i.test(a.url)))
    .map((a) => ({
      url: a.url,
      name: a.name,
      size: a.size,
      mime: a.mime,
      width: a.width,
      height: a.height,
      duration: a.duration,
    }));
}

export async function assertMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw new ApiError(404, 'Chat not found.');
  const isMember = chat.participants.some((p) => String(p.user) === String(userId));
  if (!isMember) throw new ApiError(403, 'You are not a participant of this chat.');
  return chat;
}

/**
 * Persist a message and run the full delivery fan-out.
 *
 * Extracted so the scheduled-message dispatcher shares ONE code path with the
 * live send. Anything that lives only in the caller — realtime fan-out, unread
 * bookkeeping, push, chat-list cache invalidation — would silently not happen
 * for scheduled sends, and that divergence is exactly the bug this prevents.
 *
 * `sender` must be a { _id, name } shaped object: the request path passes
 * `req.user`, the dispatcher passes the populated sender it looked up.
 */
/**
 * Refuse delivery between two people where either has blocked the other.
 *
 * Blocking was only ever enforced at the DISCOVERY layer — excluded from user
 * search, and contact requests refused (contactController / userController).
 * Nothing checked it on the send path, so a block did not stop messages through
 * an already-existing 1:1 chat. Enforced here, inside the single funnel every
 * send goes through (REST send, polls, product shares, live location and the
 * scheduled dispatcher), so no caller can miss it.
 *
 * DIRECT chats only, deliberately: in a group, blocking someone is not meant to
 * silence them for the whole room. System messages are exempt — they're the
 * app narrating itself, not one user reaching another.
 */
async function assertNotBlocked(chat, sender) {
  if (chat.isGroup) return;
  const senderId = String(sender?._id || sender);
  const other = (chat.participants || [])
    .map((p) => String(p.user?._id || p.user))
    .find((id) => id !== senderId);
  if (!other) return;

  // One query, both directions: either party's block stops delivery.
  const blocked = await User.exists({
    $or: [
      { _id: other, blockedUsers: senderId },
      { _id: senderId, blockedUsers: other },
    ],
  });
  if (blocked) throw new ApiError(403, 'You can no longer send messages to this person.');
}

export async function deliverMessage({
  chat,
  sender,
  type = 'text',
  content = '',
  attachments,
  location,
  replyTo,
  mentions,
  forwardedFrom,
  viewOnce = false,
}) {
  const chatId = String(chat._id);
  if (type !== 'system') await assertNotBlocked(chat, sender);
  // Disappearing messages: stamp an expiry so the TTL index self-deletes it.
  const expiresAt = chat.disappearingSeconds > 0 ? new Date(Date.now() + chat.disappearingSeconds * 1000) : undefined;

  let message = await Message.create({
    chat: chatId,
    sender: sender._id,
    type,
    content,
    attachments,
    location,
    replyTo: replyTo || undefined,
    mentions,
    forwardedFrom: forwardedFrom || undefined,
    expiresAt,
    viewOnce,
    deliveredTo: [sender._id],
    readBy: [{ user: sender._id, at: new Date() }],
  });

  chat.lastMessage = message._id;
  await chat.save();

  message = await populateInPlace(message);
  // Every participant's chat-list preview/order/unread count just changed.
  invalidateChatListCache(chat.participants.map((p) => p.user));

  // Realtime fan-out. Deliver to every participant's PERSONAL room (not just the
  // chat room) so online users receive it instantly even if they don't have this
  // chat open — this is what drives delivered ticks and low-latency delivery.
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId, message });
  }
  // Notification preview.
  const preview = content?.slice(0, 120) || `Sent ${type}`;
  for (const p of chat.participants) {
    const uid = String(p.user);
    if (uid === String(sender._id)) continue;
    emitToUser(uid, 'chat-updated', { chatId });
    // Off the request path (BullMQ when Redis is set, else inline): persist the
    // in-app notification AND fire a Web Push so recipients with no live socket
    // still get pinged.
    notifyUser(uid, {
      from: sender._id,
      type: chat.isGroup ? 'group_message' : 'message',
      title: chat.isGroup ? chat.name || 'New group message' : sender.name,
      body: chat.isGroup ? `${sender.name}: ${preview}` : preview,
      tag: `chat:${chatId}`,
      url: `/?chat=${chatId}`,
      data: { chatId },
    });
  }

  // WhatsApp-Business auto-reply (greeting/away) for inbound customer messages,
  // off the request path. No-op unless the other side is a business with it on.
  // `otherIds` is passed so the worker can consult its "no auto-replies" cache
  // without re-loading the chat just to learn who the recipient is — the common
  // case then costs no queries at all. Plain strings: the BullMQ payload must
  // stay JSON-serialisable.
  if (!chat.isGroup) {
    enqueue('automsg.maybe', {
      chatId,
      senderId: String(sender._id),
      otherIds: chat.participants.map((p) => String(p.user)).filter((id) => id !== String(sender._id)),
    });
  }

  return message;
}

/** Shared validation for a client-supplied message body (live or scheduled). */
export function validateOutgoing({ type = 'text', content = '', attachments, location, viewOnce }) {
  if (!USER_MESSAGE_TYPES.includes(type)) throw new ApiError(400, 'Invalid message type.');
  if (typeof content !== 'string' || content.length > MAX_CONTENT) {
    throw new ApiError(400, `Message text must be a string under ${MAX_CONTENT} characters.`);
  }
  const safeAttachments = sanitizeAttachments(attachments);
  if (!content && (!safeAttachments || safeAttachments.length === 0) && !location) {
    throw new ApiError(400, 'Message cannot be empty.');
  }
  return {
    type,
    content,
    attachments: safeAttachments,
    // View-once only applies to media.
    viewOnce: Boolean(viewOnce) && (type === 'image' || type === 'video'),
  };
}

/** Group "only admins may post" gate — shared by the live and scheduled paths. */
export function assertMayPost(chat, userId) {
  if (chat.isGroup && chat.messagingPolicy === 'admins') {
    const me = chat.participants.find((p) => String(p.user) === String(userId));
    if (!me || !groupCan(me.role, PERMISSIONS.GROUP_MANAGE)) {
      throw new ApiError(403, 'Only admins can send messages in this group.');
    }
  }
}

/**
 * Cheap membership check for handlers that only need a yes/no answer (they
 * never touch the chat document afterward). A single `.exists()` instead of
 * fetching + hydrating the whole chat — same 403/404 behavior as assertMember.
 */
async function assertIsMember(chatId, userId) {
  if (await Chat.exists({ _id: chatId, 'participants.user': userId })) return;
  const exists = await Chat.exists({ _id: chatId });
  throw new ApiError(exists ? 403 : 404, exists ? 'You are not a participant of this chat.' : 'Chat not found.');
}

/**
 * Membership-gated fetch of ONLY the requested chat fields, as a lean plain
 * object — for handlers that need a couple of fields but not a fully
 * hydrated document. One query on the (common) member path instead of a full
 * fetch-then-hydrate.
 */
async function assertMemberFields(chatId, userId, fields) {
  const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId }).select(fields).lean();
  if (chat) return chat;
  const exists = await Chat.exists({ _id: chatId });
  throw new ApiError(exists ? 403 : 404, exists ? 'You are not a participant of this chat.' : 'Chat not found.');
}

function populateMessage(query) {
  return query
    .populate('sender', SENDER_FIELDS)
    .populate('reactions.user', SENDER_FIELDS)
    .populate({ path: 'replyTo', populate: { path: 'sender', select: SENDER_FIELDS } });
}

/**
 * Same population set applied IN PLACE to an already-loaded document — avoids
 * the redundant `Message.findById` re-fetch that used to follow every
 * `.create()`/`.save()` purely to populate the response.
 */
function populateInPlace(doc) {
  return doc.populate([
    { path: 'sender', select: SENDER_FIELDS },
    { path: 'reactions.user', select: SENDER_FIELDS },
    { path: 'replyTo', populate: { path: 'sender', select: SENDER_FIELDS } },
  ]);
}

// GET /api/messages/:chatId?before=&limit=
export const getMessages = asyncHandler(async (req, res) => {
  // Needs the chat document (not just a membership yes/no) because the pinned
  // set rides along on this response — see below.
  const chat = await assertMember(req.params.chatId, req.user._id);
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const filter = { chat: req.params.chatId, deletedFor: { $ne: req.user._id } };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };

  const messages = await populateMessage(Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean());

  /* Pins come with the FIRST page only. Two reasons they belong on this
     response at all rather than a second request: the banner has to be there
     the moment the conversation paints, and a pinned message is frequently
     older than the loaded window, so the client cannot derive it from
     `messages`. Capped at MAX_PINS_PER_CHAT, so it's a bounded add. Paging
     backwards (`before`) skips them — the banner is already up by then. */
  const pins = req.query.before ? undefined : await populatedPins(chat, req.user._id);

  res.json({
    success: true,
    messages: messages.reverse(),
    ...(pins ? { pins, canPin: canPin(chat, req.user._id) } : {}),
  });
});

// POST /api/messages  — send a message (persist + realtime broadcast)
export const sendMessage = asyncHandler(async (req, res) => {
  const { chatId, content = '', type = 'text', replyTo, location, mentions, forwardedFrom } = req.body;
  const chat = await assertMember(chatId, req.user._id);

  assertMayPost(chat, req.user._id);

  // Validate client-supplied fields (don't trust type/attachments/content blindly).
  const safe = validateOutgoing({ ...req.body, type, content });
  const safeMentions = Array.isArray(mentions) ? mentions.slice(0, 100) : undefined;

  const message = await deliverMessage({
    chat,
    sender: req.user,
    ...safe,
    location,
    replyTo,
    mentions: safeMentions,
    forwardedFrom,
  });

  res.status(201).json({ success: true, message });
});

// PATCH /api/messages/:id  — edit
export const editMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertIsMember(message.chat, req.user._id);
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own messages.');
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new ApiError(403, 'Messages can only be edited within 5 minutes of sending.');
  }

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

  const populated = await populateInPlace(message);
  emitToChat(String(message.chat), 'message-edited', { chatId: String(message.chat), message: populated });
  // Connected viewers update live via the socket event above regardless; this
  // just keeps a fresh REST reload of the editor's OWN list from showing stale
  // preview text if this happened to be the chat's last message.
  invalidateChatListCache(req.user._id);
  res.json({ success: true, message: populated });
});

// DELETE /api/messages/:id?scope=me|everyone
export const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertIsMember(message.chat, req.user._id);
  const scope = req.query.scope || 'me';

  if (scope === 'everyone') {
    if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'You can only delete your own messages for everyone.');
    if (Date.now() - message.createdAt.getTime() > DELETE_EVERYONE_WINDOW_MS) {
      throw new ApiError(403, 'You can only delete for everyone within 5 minutes of sending. Delete for yourself instead.');
    }
    message.isDeleted = true;
    message.content = '';
    message.attachments = [];
    await message.save();
    emitToChat(String(message.chat), 'message-deleted', { chatId: String(message.chat), messageId: message._id, scope });
  } else {
    await Message.findByIdAndUpdate(message._id, { $addToSet: { deletedFor: req.user._id } });
  }
  invalidateChatListCache(req.user._id); // same rationale as editMessage above
  res.json({ success: true });
});

// POST /api/messages/:id/react  { emoji }
export const reactToMessage = asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertIsMember(message.chat, req.user._id);

  const existing = message.reactions.find((r) => String(r.user) === String(req.user._id));
  if (existing && existing.emoji === emoji) {
    message.reactions = message.reactions.filter((r) => String(r.user) !== String(req.user._id));
  } else if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ user: req.user._id, emoji });
  }
  await message.save();

  const populated = await populateInPlace(message);
  emitToChat(String(message.chat), 'message-reaction', {
    chatId: String(message.chat),
    messageId: String(message._id),
    reactions: populated.reactions,
  });
  res.json({ success: true, message: populated });
});

// POST /api/messages/:id/star  (toggle)
export const toggleStar = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id).select('chat starredBy');
  if (!message) throw new ApiError(404, 'Message not found.');
  await assertIsMember(message.chat, req.user._id);
  const starred = message.starredBy.some((u) => String(u) === String(req.user._id));
  await Message.updateOne({ _id: message._id }, starred ? { $pull: { starredBy: req.user._id } } : { $addToSet: { starredBy: req.user._id } });
  res.json({ success: true, starred: !starred });
});

// GET /api/messages/starred
/**
 * GET /api/messages/starred?before=&limit=
 *
 * The starred list is a real screen now (it used to be fetched only to count
 * the rows in a toast), so it is paginated like any other feed and carries
 * enough chat context to render + navigate each row without an N+1 lookup.
 *
 * Locked chats are excluded: those conversations are hidden behind the PIN, and
 * a star shouldn't be a side door into their contents.
 */
export const getStarred = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const locked = (req.user.lockedChats || []).map(String);
  const filter = {
    starredBy: req.user._id,
    deletedFor: { $ne: req.user._id },
    isDeleted: false,
  };
  if (locked.length) filter.chat = { $nin: locked };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };

  const messages = await populateMessage(
    Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1) // one extra row = "is there another page?" without a count()
      .lean()
  ).then((rows) =>
    Message.populate(rows, {
      path: 'chat',
      select: 'name isGroup avatar participants',
      populate: { path: 'participants.user', select: 'name username avatar' },
    })
  );

  const hasMore = messages.length > limit;
  res.json({ success: true, messages: hasMore ? messages.slice(0, limit) : messages, hasMore });
});

// POST /api/messages/read  { chatId }
export const markRead = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  await assertIsMember(chatId, req.user._id);
  await Message.updateMany(
    { chat: chatId, sender: { $ne: req.user._id }, 'readBy.user': { $ne: req.user._id } },
    { $push: { readBy: { user: req.user._id, at: new Date() } } }
  );
  // Respect the reader's read-receipt privacy: don't reveal read state if off.
  if (req.user.privacy?.readReceipts !== false) {
    emitToChat(chatId, 'message-read', { chatId, userId: String(req.user._id) });
  }
  invalidateChatListCache(req.user._id); // this chat's unreadCount just dropped to 0
  res.json({ success: true });
});

/**
 * GET /api/messages/:chatId/search?q=&before=&limit=
 *
 * Searches the WHOLE conversation. The client used to filter only the page of
 * messages it happened to have in memory, so anything above the current scroll
 * position simply didn't exist as far as search was concerned.
 *
 * The regex rides the `{chat:1, createdAt:-1}` index for the chat scope, so the
 * scan is bounded to one conversation and ordered — no collection-wide sort.
 */
export const searchMessages = asyncHandler(async (req, res) => {
  /* Membership gate. Keep this EXPLICIT: it used to ride along on an
     assertMemberFields() call that also fetched the chat's encryption flag, and
     removing encryption removed the fetch — and with it, silently, the
     authorisation check, letting any authenticated user search any conversation.
     This handler only needs the yes/no answer, so ask for exactly that. */
  await assertIsMember(req.params.chatId, req.user._id);

  const q = (req.query.q || '').trim().slice(0, 128);
  if (!q) return res.json({ success: true, messages: [], hasMore: false });

  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const filter = {
    chat: req.params.chatId,
    content: rx,
    isDeleted: false,
    deletedFor: { $ne: req.user._id },
  };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };

  const rows = await populateMessage(Message.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean());
  const hasMore = rows.length > limit;
  res.json({ success: true, messages: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

/**
 * GET /api/messages/:chatId/context/:messageId?radius=
 *
 * The window of messages around one message — what "jump to this result" needs
 * when the hit is older than anything currently loaded. Without it, tapping a
 * search result from six months ago has nowhere to land.
 *
 * Two bounded queries either side of the anchor rather than a skip/limit walk,
 * so cost doesn't grow with how far back the message is.
 */
export const getMessageContext = asyncHandler(async (req, res) => {
  await assertIsMember(req.params.chatId, req.user._id);
  const radius = Math.min(Number(req.query.radius) || 20, 50);

  const anchor = await Message.findOne({ _id: req.params.messageId, chat: req.params.chatId }).lean();
  if (!anchor) throw new ApiError(404, 'Message not found in this chat.');

  const base = { chat: req.params.chatId, deletedFor: { $ne: req.user._id } };
  const [before, after] = await Promise.all([
    populateMessage(
      Message.find({ ...base, createdAt: { $lt: anchor.createdAt } }).sort({ createdAt: -1 }).limit(radius).lean()
    ),
    populateMessage(
      Message.find({ ...base, createdAt: { $gt: anchor.createdAt } }).sort({ createdAt: 1 }).limit(radius).lean()
    ),
  ]);
  const [anchorPopulated] = await populateMessage(Message.find({ _id: anchor._id }).lean());

  res.json({
    success: true,
    messages: [...before.reverse(), anchorPopulated, ...after],
    // False when there's older history above this window, so the client knows
    // it is looking at a slice and not the top of the conversation.
    atStart: before.length < radius,
    atEnd: after.length < radius,
  });
});

// POST /api/messages/:id/viewed  — consume a view-once message.
// Each recipient may see it once; the media is purged from storage/DB once every
// recipient has opened it. The client hides it for anyone already in viewedBy.
export const markViewed = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new ApiError(404, 'Message not found.');
  const chat = await assertMemberFields(message.chat, req.user._id, 'participants');
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
    const populated = await populateInPlace(message);
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

  message = await populateInPlace(message);
  invalidateChatListCache(chat.participants.map((p) => p.user));
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
  await assertIsMember(message.chat, req.user._id);
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
  const populated = await populateInPlace(message);
  emitToChat(String(message.chat), 'message-updated', { chatId: String(message.chat), message: populated });
  res.json({ success: true, message: populated });
});

// POST /api/messages/:id/pin  (toggle at chat level)
/**
 * POST /api/messages/:id/pin  { hours: 1 | 6 | 12 | 24 }
 *
 * Pins a message for everyone in the chat until it expires. In a GROUP this is
 * admins-only (a pin is a broadcast, so it's a moderation action — see
 * utils/pins.js); in a direct chat either person can.
 *
 * Re-pinning an already-pinned message resets its timer rather than erroring,
 * which is what "pin for 24h" means when you meant "keep it up longer".
 */
export const pinMessage = asyncHandler(async (req, res) => {
  const hours = assertValidDuration(req.body.hours);
  const message = await Message.findById(req.params.id).select('chat isDeleted');
  if (!message) throw new ApiError(404, 'Message not found.');
  if (message.isDeleted) throw new ApiError(400, 'That message was deleted.');

  const chat = await assertMember(message.chat, req.user._id);
  assertMayPin(chat, req.user._id);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const pin = { message: message._id, pinnedBy: req.user._id, pinnedAt: now, expiresAt, durationHours: hours };

  // Start from only the LIVE pins: this is also where lapsed ones get dropped
  // for a chat nobody has swept yet.
  const live = activePins(chat, now.getTime()).filter((p) => String(p.message) !== String(message._id));
  live.unshift(pin);
  // Oldest-first eviction past the cap (see MAX_PINS_PER_CHAT).
  const evicted = live.slice(MAX_PINS_PER_CHAT);
  chat.pins = live.slice(0, MAX_PINS_PER_CHAT);
  await chat.save();

  emitToChat(String(chat._id), 'message-pinned', {
    chatId: String(chat._id),
    messageId: String(message._id),
    pinned: true,
    pin: serializePin(pin),
  });
  // Tell clients about anything the cap pushed off, or their banner keeps a pin
  // the server no longer has.
  for (const gone of evicted) {
    emitToChat(String(chat._id), 'message-pinned', {
      chatId: String(chat._id),
      messageId: String(gone.message),
      pinned: false,
      reason: 'evicted',
    });
  }

  res.json({ success: true, pinned: true, pin: serializePin(pin), evicted: evicted.map((p) => String(p.message)) });
});

/**
 * DELETE /api/messages/:id/pin — unpin early.
 * Whoever pinned it can always remove it; group admins can remove anyone's.
 */
export const unpinMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id).select('chat');
  if (!message) throw new ApiError(404, 'Message not found.');
  const chat = await assertMember(message.chat, req.user._id);

  const pin = (chat.pins || []).find((p) => String(p.message) === String(message._id));
  if (!pin) return res.json({ success: true, pinned: false });
  if (!canUnpin(chat, pin, req.user._id)) {
    throw new ApiError(403, 'Only a group admin (or whoever pinned it) can unpin this message.');
  }

  await Chat.updateOne({ _id: chat._id }, { $pull: { pins: { message: message._id } } });
  emitToChat(String(chat._id), 'message-pinned', {
    chatId: String(chat._id),
    messageId: String(message._id),
    pinned: false,
    reason: 'unpinned',
  });
  res.json({ success: true, pinned: false });
});

/** GET /api/messages/:chatId/pins — the live pins with their messages. */
export const getPins = asyncHandler(async (req, res) => {
  const chat = await assertMember(req.params.chatId, req.user._id);
  res.json({
    success: true,
    pins: await populatedPins(chat, req.user._id),
    canPin: canPin(chat, req.user._id),
  });
});

/* ── Scheduled messages ───────────────────────────────────────────────────────
   Pending rows live in their own collection (see models/ScheduledMessage.js) and
   only become real Messages at dispatch, through the same deliverMessage() the
   live send uses. utils/scheduledDispatcher.js drives the sending. */

// Refuse a schedule so near-term that the dispatcher's tick would fire it late
// anyway — it reads as broken to the user.
const MIN_SCHEDULE_LEAD_MS = 10_000;
const MAX_PENDING_PER_CHAT = 50;

// POST /api/messages/schedule
export const scheduleMessage = asyncHandler(async (req, res) => {
  const { chatId, content = '', type = 'text', replyTo, location, mentions, sendAt } = req.body;
  const chat = await assertMember(chatId, req.user._id);
  assertMayPost(chat, req.user._id);

  const when = new Date(sendAt);
  if (Number.isNaN(when.getTime())) throw new ApiError(400, 'sendAt must be a valid date.');
  if (when.getTime() - Date.now() < MIN_SCHEDULE_LEAD_MS) {
    throw new ApiError(400, 'Pick a time at least a few seconds from now.');
  }

  // Same validation as a live send, so a scheduled message can never carry a
  // payload the live path would have rejected.
  const safe = validateOutgoing({ ...req.body, type, content });

  const pending = await ScheduledMessage.countDocuments({ chat: chatId, sender: req.user._id, status: 'pending' });
  if (pending >= MAX_PENDING_PER_CHAT) {
    throw new ApiError(400, `You can have at most ${MAX_PENDING_PER_CHAT} scheduled messages per chat.`);
  }

  const row = await ScheduledMessage.create({
    chat: chatId,
    sender: req.user._id,
    type: safe.type,
    content: safe.content,
    attachments: safe.attachments,
    location,
    replyTo: replyTo || undefined,
    mentions: Array.isArray(mentions) ? mentions.slice(0, 100) : undefined,
    sendAt: when,
  });

  // Keep the author's other devices in step.
  emitToUser(String(req.user._id), 'scheduled-message', { id: String(row._id), chatId: String(chatId), status: 'pending' });
  res.status(201).json({ success: true, scheduled: row });
});

// GET /api/messages/scheduled/:chatId — my own pending items for this chat
export const listScheduled = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);
  const scheduled = await ScheduledMessage.find({
    chat: req.params.chatId,
    sender: req.user._id,
    status: { $in: ['pending', 'failed'] },
  })
    .sort({ sendAt: 1 })
    .lean();
  res.json({ success: true, scheduled });
});

// DELETE /api/messages/scheduled/:id
export const cancelScheduled = asyncHandler(async (req, res) => {
  // Scoped to the owner AND to a still-cancellable state in the query itself: a
  // row the dispatcher has already claimed ('sending') must not be yanked out
  // from under it, which a read-then-write check could race with.
  const row = await ScheduledMessage.findOneAndUpdate(
    { _id: req.params.id, sender: req.user._id, status: 'pending' },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!row) throw new ApiError(404, 'That scheduled message is no longer pending.');
  emitToUser(String(req.user._id), 'scheduled-message', { id: String(row._id), chatId: String(row.chat), status: 'cancelled' });
  res.json({ success: true });
});

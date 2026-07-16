import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat } from '../socket/index.js';
import { verifyTwoStepPin } from './userController.js';

const USER_FIELDS = 'name username email avatar bio isOnline lastSeen';

/** Populate a chat with participant + lastMessage details. */
function populateChat(query) {
  return query
    .populate('participants.user', USER_FIELDS)
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name username avatar' } });
}

/**
 * Unread counts for MANY chats in a SINGLE aggregation (was an N+1: one
 * countDocuments per chat). Returns a Map<chatId, count>. On a 50-chat list
 * this collapses 50 round-trips into one.
 */
async function unreadCountsFor(chatIds, userId) {
  if (!chatIds.length) return new Map();
  const rows = await Message.aggregate([
    {
      $match: {
        chat: { $in: chatIds },
        sender: { $ne: userId },
        isDeleted: false,
        'readBy.user': { $ne: userId },
        deletedFor: { $ne: userId },
      },
    },
    { $group: { _id: '$chat', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

// GET /api/chats  — all conversations for the current user (locked chats hidden;
// they surface only via POST /api/chats/locked after the PIN is entered)
export const getChats = asyncHandler(async (req, res) => {
  const locked = (req.user.lockedChats || []).map(String);
  const chats = await populateChat(
    Chat.find({ 'participants.user': req.user._id, _id: { $nin: locked } }).sort({ updatedAt: -1 })
  );

  // Per-user chat flags (pin / archive / mute) live on the User doc — surface
  // them on each chat so they persist across reloads and devices.
  const pinned = new Set((req.user.pinnedChats || []).map(String));
  const archived = new Set((req.user.archivedChats || []).map(String));
  const muted = new Set((req.user.mutedChats || []).map(String));

  const counts = await unreadCountsFor(chats.map((c) => c._id), req.user._id);
  const withMeta = chats.map((chat) => {
    const id = String(chat._id);
    return {
      ...chat.toObject(),
      unreadCount: counts.get(id) || 0,
      pinned: pinned.has(id),
      archived: archived.has(id),
      muted: muted.has(id),
    };
  });

  res.json({ success: true, chats: withMeta });
});

// POST /api/chats/direct/:userId — get-or-create a 1:1 chat
export const accessDirectChat = asyncHandler(async (req, res) => {
  const otherId = req.params.userId;
  if (otherId === String(req.user._id)) throw new ApiError(400, "You can't chat with yourself.");

  const other = await User.findById(otherId);
  if (!other) throw new ApiError(404, 'User not found.');

  let chat = await Chat.findOne({
    isGroup: false,
    'participants.user': { $all: [req.user._id, otherId] },
    $expr: { $eq: [{ $size: '$participants' }, 2] },
  });

  if (!chat) {
    // You must be MUTUALLY connected (both accepted) before starting a new 1:1 chat.
    // Checking both directions prevents a one-sided/unilateral add from opening a chat.
    // Connections may cross workspace/personal boundaries (global reachability).
    const iHaveThem = (req.user.contacts || []).some((c) => String(c) === String(otherId));
    const theyHaveMe = (other.contacts || []).some((c) => String(c) === String(req.user._id));
    if (!(iHaveThem && theyHaveMe)) {
      throw new ApiError(403, 'Send a contact request and get accepted before you can chat.');
    }
    // A cross-tenant DM isn't owned by either workspace (so it's never swept by
    // workspace member-removal); a same-workspace DM keeps its workspace tag.
    const sameWs = other.workspace && String(other.workspace) === String(req.user.workspace);
    chat = await Chat.create({
      isGroup: false,
      workspace: sameWs ? req.user.workspace : null,
      participants: [{ user: req.user._id }, { user: otherId }],
    });
  }

  chat = await populateChat(Chat.findById(chat._id));
  res.json({ success: true, chat });
});

// GET /api/chats/:id
export const getChatById = asyncHandler(async (req, res) => {
  const chat = await populateChat(Chat.findById(req.params.id));
  if (!chat) throw new ApiError(404, 'Chat not found.');
  const isMember = chat.participants.some((p) => String(p.user._id) === String(req.user._id));
  if (!isMember) throw new ApiError(403, 'You are not a participant of this chat.');
  res.json({ success: true, chat });
});

// PATCH /api/chats/:id/disappearing  { seconds }  — 0 turns it off. Any member
// can set the timer (WhatsApp-style); it applies to all future messages.
export const setDisappearing = asyncHandler(async (req, res) => {
  const seconds = Math.max(0, Math.min(Math.floor(Number(req.body.seconds) || 0), 60 * 60 * 24 * 90));
  const chat = await Chat.findOne({ _id: req.params.id, 'participants.user': req.user._id });
  if (!chat) throw new ApiError(403, 'You are not a participant of this chat.');
  chat.disappearingSeconds = seconds;
  await chat.save();
  emitToChat(String(chat._id), 'chat-disappearing', { chatId: String(chat._id), seconds });
  res.json({ success: true, disappearingSeconds: seconds });
});

// POST /api/chats/:id/lock — hide a chat behind the two-step PIN (chat lock).
// Requires the PIN to be set up first (it's the unlock method).
export const lockChat = asyncHandler(async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, 'participants.user': req.user._id }).select('_id');
  if (!chat) throw new ApiError(403, 'You are not a participant of this chat.');
  if (!req.user.twoStepEnabled) throw new ApiError(400, 'Set up a two-step PIN first to lock chats.');
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { lockedChats: chat._id } });
  res.json({ success: true, locked: true });
});

// POST /api/chats/:id/unlock — move a chat back to the main list
export const unlockChat = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $pull: { lockedChats: req.params.id } });
  res.json({ success: true, locked: false });
});

// POST /api/chats/locked  { pin }  — reveal locked chats after verifying the PIN
export const getLockedChats = asyncHandler(async (req, res) => {
  if (!(await verifyTwoStepPin(req.user._id, req.body.pin))) throw new ApiError(403, 'Incorrect PIN.');
  const locked = (req.user.lockedChats || []).map(String);
  const chats = await populateChat(
    Chat.find({ 'participants.user': req.user._id, _id: { $in: locked } }).sort({ updatedAt: -1 })
  );
  const counts = await unreadCountsFor(chats.map((c) => c._id), req.user._id);
  const withMeta = chats.map((chat) => ({ ...chat.toObject(), unreadCount: counts.get(String(chat._id)) || 0, locked: true }));
  res.json({ success: true, chats: withMeta });
});

// DELETE /api/chats/:id/clear — clear messages for me only
export const clearChat = asyncHandler(async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, 'participants.user': req.user._id }).select('_id');
  if (!chat) throw new ApiError(403, 'You are not a participant of this chat.');
  await Message.updateMany(
    { chat: req.params.id },
    { $addToSet: { deletedFor: req.user._id } }
  );
  res.json({ success: true, message: 'Chat cleared for you.' });
});

// DELETE /api/chats/:id — leave/remove chat for the user
export const deleteChat = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw new ApiError(404, 'Chat not found.');

  if (chat.isGroup) {
    chat.participants = chat.participants.filter((p) => String(p.user) !== String(req.user._id));
    if (chat.participants.length === 0) await chat.deleteOne();
    else await chat.save();
  } else {
    // For 1:1, just clear it for this user.
    await Message.updateMany({ chat: chat._id }, { $addToSet: { deletedFor: req.user._id } });
  }
  res.json({ success: true, message: 'Chat removed.' });
});

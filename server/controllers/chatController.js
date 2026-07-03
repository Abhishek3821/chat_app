import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

const USER_FIELDS = 'name username email avatar bio isOnline lastSeen';

/** Populate a chat with participant + lastMessage details. */
function populateChat(query) {
  return query
    .populate('participants.user', USER_FIELDS)
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name username avatar' } });
}

// GET /api/chats  — all conversations for the current user
export const getChats = asyncHandler(async (req, res) => {
  const chats = await populateChat(
    Chat.find({ 'participants.user': req.user._id }).sort({ updatedAt: -1 })
  );

  // Attach per-user unread counts.
  const withMeta = await Promise.all(
    chats.map(async (chat) => {
      const unread = await Message.countDocuments({
        chat: chat._id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
        isDeleted: false,
        deletedFor: { $ne: req.user._id },
      });
      return { ...chat.toObject(), unreadCount: unread };
    })
  );

  res.json({ success: true, chats: withMeta });
});

// POST /api/chats/direct/:userId — get-or-create a 1:1 chat
export const accessDirectChat = asyncHandler(async (req, res) => {
  const otherId = req.params.userId;
  if (otherId === String(req.user._id)) throw new ApiError(400, "You can't chat with yourself.");

  const other = await User.findById(otherId);
  if (!other) throw new ApiError(404, 'User not found.');
  if (String(other.workspace) !== String(req.user.workspace)) {
    throw new ApiError(403, 'You can only chat with people in your workspace.');
  }

  let chat = await Chat.findOne({
    isGroup: false,
    'participants.user': { $all: [req.user._id, otherId] },
    $expr: { $eq: [{ $size: '$participants' }, 2] },
  });

  if (!chat) {
    // You must be MUTUALLY connected (both accepted) before starting a new 1:1 chat.
    // Checking both directions prevents a one-sided/unilateral add from opening a chat.
    const iHaveThem = (req.user.contacts || []).some((c) => String(c) === String(otherId));
    const theyHaveMe = (other.contacts || []).some((c) => String(c) === String(req.user._id));
    if (!(iHaveThem && theyHaveMe)) {
      throw new ApiError(403, 'Send a contact request and get accepted before you can chat.');
    }
    chat = await Chat.create({
      isGroup: false,
      workspace: req.user.workspace,
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

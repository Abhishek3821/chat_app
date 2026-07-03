import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat, emitToUser } from '../socket/index.js';

const USER_FIELDS = 'name username email avatar bio isOnline lastSeen';

function requireAdmin(chat, userId) {
  const me = chat.participants.find((p) => String(p.user) === String(userId));
  if (!me || me.role === 'member') throw new ApiError(403, 'Admin privileges required.');
  return me;
}

async function systemMessage(chatId, text, event) {
  const msg = await Message.create({ chat: chatId, type: 'system', content: text, systemEvent: event });
  await Chat.findByIdAndUpdate(chatId, { lastMessage: msg._id });
  emitToChat(String(chatId), 'receive-message', { chatId: String(chatId), message: msg });
}

// POST /api/groups
export const createGroup = asyncHandler(async (req, res) => {
  const { name, description = '', avatar = '', members = [] } = req.body;
  if (!name) throw new ApiError(400, 'Group name is required.');

  const uniqueMembers = [...new Set(members.map(String))].filter((id) => id !== String(req.user._id));
  // Tenant isolation: only members in the same workspace can be added.
  const sameWs = uniqueMembers.length
    ? (await User.find({ _id: { $in: uniqueMembers }, workspace: req.user.workspace }).select('_id')).map((u) => String(u._id))
    : [];
  const participants = [
    { user: req.user._id, role: 'owner' },
    ...sameWs.map((id) => ({ user: id, role: 'member' })),
  ];

  let chat = await Chat.create({
    isGroup: true,
    workspace: req.user.workspace,
    name,
    description,
    avatar: avatar || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(name)}`,
    createdBy: req.user._id,
    participants,
  });

  await systemMessage(chat._id, `${req.user.name} created “${name}”`, 'group_created');

  chat = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  chat.participants.forEach((p) => emitToUser(String(p.user._id), 'chat-updated', { chatId: String(chat._id) }));
  res.status(201).json({ success: true, chat });
});

// PATCH /api/groups/:id
export const updateGroup = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);

  ['name', 'description', 'avatar', 'messagingPolicy'].forEach((k) => {
    if (req.body[k] !== undefined) chat[k] = req.body[k];
  });
  await chat.save();
  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// POST /api/groups/:id/members  { members: [ids] }
export const addMembers = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);

  const existing = new Set(chat.participants.map((p) => String(p.user)));
  const requested = (req.body.members || []).map(String).filter((id) => !existing.has(id));

  // Honor each invitee's groupAddPermission: 'contacts' means only their own
  // contacts may pull them into a group — otherwise anyone could add anyone.
  const candidates = await User.find({ _id: { $in: requested }, workspace: chat.workspace }).select('name privacy contacts');
  const added = candidates.filter((u) => {
    const perm = u.privacy?.groupAddPermission || 'everyone';
    if (perm === 'contacts') return (u.contacts || []).some((c) => String(c) === String(req.user._id));
    return true;
  });
  const toAdd = added.map((u) => String(u._id));
  chat.participants.push(...toAdd.map((id) => ({ user: id, role: 'member' })));
  await chat.save();
  if (added.length) await systemMessage(chat._id, `${req.user.name} added ${added.map((u) => u.name).join(', ')}`, 'member_added');

  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  toAdd.forEach((id) => emitToUser(id, 'chat-updated', { chatId: String(chat._id) }));
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// DELETE /api/groups/:id/members/:userId
export const removeMember = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);

  const target = await User.findById(req.params.userId).select('name');
  chat.participants = chat.participants.filter((p) => String(p.user) !== req.params.userId);
  await chat.save();
  if (target) await systemMessage(chat._id, `${target.name} was removed`, 'member_removed');

  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  emitToUser(req.params.userId, 'chat-updated', { chatId: String(chat._id) });
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// PATCH /api/groups/:id/members/:userId/role  { role: 'admin'|'member' }
export const setMemberRole = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) throw new ApiError(400, 'Invalid role.');

  const member = chat.participants.find((p) => String(p.user) === req.params.userId);
  if (!member) throw new ApiError(404, 'Member not found.');
  if (member.role === 'owner') throw new ApiError(400, "Owner's role can't be changed.");
  member.role = role;
  await chat.save();

  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// POST /api/groups/:id/leave
export const leaveGroup = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  chat.participants = chat.participants.filter((p) => String(p.user) !== String(req.user._id));
  if (chat.participants.length === 0) {
    await chat.deleteOne();
    return res.json({ success: true, deleted: true });
  }
  // If the owner left, promote the earliest-joined member.
  if (!chat.participants.some((p) => p.role === 'owner')) chat.participants[0].role = 'owner';
  await chat.save();
  await systemMessage(chat._id, `${req.user.name} left the group`, 'member_left');
  emitToChat(String(chat._id), 'group-updated', { chatId: String(chat._id) });
  res.json({ success: true });
});

// POST /api/groups/join/:inviteCode
export const joinByInvite = asyncHandler(async (req, res) => {
  const chat = await Chat.findOne({ inviteCode: req.params.inviteCode, isGroup: true });
  if (!chat) throw new ApiError(404, 'Invite is invalid.');
  if (chat.workspace && String(chat.workspace) !== String(req.user.workspace)) {
    throw new ApiError(403, 'This group belongs to another workspace.');
  }
  if (chat.participants.some((p) => String(p.user) === String(req.user._id))) {
    return res.json({ success: true, chat, alreadyMember: true });
  }
  chat.participants.push({ user: req.user._id, role: 'member' });
  await chat.save();
  await systemMessage(chat._id, `${req.user.name} joined via invite link`, 'member_joined');
  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  res.json({ success: true, chat: populated });
});

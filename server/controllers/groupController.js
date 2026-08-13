import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { tenantScope } from '../utils/tenancy.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToChat, emitToUser } from '../socket/index.js';
import { groupCan, PERMISSIONS } from '../utils/rbac.js';
import { invalidateChatListCache } from '../utils/chatCache.js';

const USER_FIELDS = 'name username email avatar bio isOnline lastSeen';

/**
 * Turn the ids a caller wants in a group into the users who may actually be
 * added, plus a per-person reason for everyone who may not.
 *
 * There are exactly two gates:
 *   1. The embedded-TENANT boundary (utils/tenancy.js) — a hard wall.
 *   2. The invitee's OWN `privacy.groupAddPermission` (Settings → Privacy →
 *      "Who can add me to groups"): 'contacts' means only someone already in
 *      their contact list may pull them in; 'everyone' means anyone may.
 *      A block in either direction also stops the add — otherwise 'everyone'
 *      would let a blocked user reach you through a group.
 *
 * There is deliberately NO workspace equality check. Contact requests, DMs and
 * calls all cross workspace/personal boundaries by design (global
 * reachability), so `workspace: req.user.workspace` here meant every
 * cross-workspace contact was DROPPED WITHOUT A WORD: the group was created
 * containing nobody but its creator, the API still answered 201, and the people
 * you picked never saw the group at all. Who can reach you is now decided by
 * the privacy setting you actually control, and anyone who can't be added is
 * reported back instead of vanishing.
 *
 * @returns {{ members: import('mongoose').Document[], skipped: {user: string, name?: string, reason: string}[] }}
 */
async function resolveInvitees(inviter, requestedIds) {
  const ids = [...new Set((requestedIds || []).map(String))].filter((id) => id !== String(inviter._id));
  if (!ids.length) return { members: [], skipped: [] };

  // Only look up well-formed ids: a junk string would make Mongoose throw a
  // CastError and turn a bad member id into a 500.
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  const found = valid.length
    ? await User.find({ _id: { $in: valid }, ...tenantScope(inviter) })
        .select('name workspace privacy contacts blockedUsers')
    : [];
  const byId = new Map(found.map((u) => [String(u._id), u]));

  const iBlocked = new Set((inviter.blockedUsers || []).map(String));
  const members = [];
  const skipped = [];
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) {
      skipped.push({ user: id, reason: 'not_found' });
      continue;
    }
    if (iBlocked.has(id) || (u.blockedUsers || []).some((b) => String(b) === String(inviter._id))) {
      skipped.push({ user: id, name: u.name, reason: 'blocked' });
      continue;
    }
    const perm = u.privacy?.groupAddPermission || 'everyone';
    const isContact = (u.contacts || []).some((c) => String(c) === String(inviter._id));
    if (perm === 'contacts' && !isContact) {
      skipped.push({ user: id, name: u.name, reason: 'privacy' });
      continue;
    }
    members.push(u);
  }
  return { members, skipped };
}

/**
 * The workspace a group should be tagged with.
 *
 * Removing someone from a workspace pulls them out of every chat tagged with it
 * (workspaceController.removeMember), so a tag must mean "every member belongs
 * to this workspace". A group that mixes workspaces is owned by neither — the
 * same rule 1:1 chats already follow in chatController.accessDirectChat.
 */
function workspaceTagFor(ownerWorkspace, members) {
  if (!ownerWorkspace) return null;
  const allShare = members.every((u) => u.workspace && String(u.workspace) === String(ownerWorkspace));
  return allShare ? ownerWorkspace : null;
}

// Require a specific group permission (from the central RBAC matrix) for the
// caller's per-chat role. Defaults to GROUP_MANAGE (the old "admin" gate).
function requireGroupPerm(chat, userId, permission = PERMISSIONS.GROUP_MANAGE) {
  const me = chat.participants.find((p) => String(p.user) === String(userId));
  if (!me || !groupCan(me.role, permission)) throw new ApiError(403, 'Admin privileges required.');
  return me;
}
const requireAdmin = requireGroupPerm; // back-compat alias for existing call sites

async function systemMessage(chatId, text, event) {
  const msg = await Message.create({ chat: chatId, type: 'system', content: text, systemEvent: event });
  await Chat.findByIdAndUpdate(chatId, { lastMessage: msg._id });
  emitToChat(String(chatId), 'receive-message', { chatId: String(chatId), message: msg });
}

// POST /api/groups
export const createGroup = asyncHandler(async (req, res) => {
  const { name, description = '', avatar = '', members = [] } = req.body;
  if (!name) throw new ApiError(400, 'Group name is required.');
  if (!Array.isArray(members)) throw new ApiError(400, 'members must be a list.');

  // Same two gates as adding someone later — see resolveInvitees().
  const { members: invitees, skipped } = await resolveInvitees(req.user, members);
  const participants = [
    { user: req.user._id, role: 'owner' },
    ...invitees.map((u) => ({ user: u._id, role: 'member' })),
  ];

  let chat = await Chat.create({
    isGroup: true,
    workspace: workspaceTagFor(req.user.workspace, invitees),
    name,
    description,
    avatar: avatar || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(name)}`,
    createdBy: req.user._id,
    participants,
  });

  await systemMessage(chat._id, `${req.user.name} created “${name}”`, 'group_created');

  chat = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  /* Every member's chat list just gained a row. Without this the socket nudge
     below races the cache: the invitee refetches within milliseconds, gets the
     10s-old cached list back, and the group stays invisible to them until
     something else happens to refresh it. */
  await invalidateChatListCache(participants.map((p) => p.user));
  chat.participants.forEach((p) => emitToUser(String(p.user._id), 'chat-updated', { chatId: String(chat._id) }));
  // `skipped` tells the creator who couldn't be added and why, instead of
  // silently handing back a group with fewer people in it than they picked.
  res.status(201).json({ success: true, chat, skipped });
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
  // The name/avatar shown on every member's chat-list row just changed.
  await invalidateChatListCache(chat.participants.map((p) => p.user));
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// POST /api/groups/:id/members  { members: [ids] }
export const addMembers = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);

  if (req.body.members !== undefined && !Array.isArray(req.body.members)) {
    throw new ApiError(400, 'members must be a list.');
  }
  const existing = new Set(chat.participants.map((p) => String(p.user)));
  const requested = (req.body.members || []).map(String).filter((id) => !existing.has(id));

  const { members: added, skipped } = await resolveInvitees(req.user, requested);
  const toAdd = added.map((u) => String(u._id));
  chat.participants.push(...toAdd.map((id) => ({ user: id, role: 'member' })));
  // A group tagged with a workspace means all of its members are in it, and
  // the workspace's member-removal sweep acts on that. Bringing in someone from
  // outside makes the group nobody's — see workspaceTagFor().
  if (chat.workspace && added.some((u) => String(u.workspace) !== String(chat.workspace))) chat.workspace = null;
  await chat.save();
  if (added.length) await systemMessage(chat._id, `${req.user.name} added ${added.map((u) => u.name).join(', ')}`, 'member_added');

  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  // New members gain a row; everyone else's preview/order changed with the
  // system message above.
  await invalidateChatListCache(chat.participants.map((p) => p.user));
  toAdd.forEach((id) => emitToUser(id, 'chat-updated', { chatId: String(chat._id) }));
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated, skipped });
});

// DELETE /api/groups/:id/members/:userId
export const removeMember = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  requireAdmin(chat, req.user._id);

  // Protect the owner: a plain admin can't remove the group owner (matches the
  // guard on setMemberRole). Only the owner could, and they can't remove
  // themselves this way — they use leaveGroup, which reassigns ownership.
  const targetMember = chat.participants.find((p) => String(p.user) === req.params.userId);
  if (targetMember?.role === 'owner') throw new ApiError(400, "The group owner can't be removed.");

  const target = await User.findById(req.params.userId).select('name');
  const priorParticipants = chat.participants.map((p) => p.user);
  chat.participants = chat.participants.filter((p) => String(p.user) !== req.params.userId);
  await chat.save();
  if (target) await systemMessage(chat._id, `${target.name} was removed`, 'member_removed');

  const populated = await Chat.findById(chat._id).populate('participants.user', USER_FIELDS);
  // Prior list, so the removed member's own cached list loses the row too.
  await invalidateChatListCache(priorParticipants);
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
  /* Roles ride along on every chat-list row (`participants[].role`), and the
     client gates its group-management controls on them — so a promotion that
     isn't invalidated leaves the new admin reloading into the old member view. */
  await invalidateChatListCache(chat.participants.map((p) => p.user));
  emitToChat(String(chat._id), 'group-updated', { chat: populated });
  res.json({ success: true, chat: populated });
});

// POST /api/groups/:id/leave
export const leaveGroup = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat?.isGroup) throw new ApiError(404, 'Group not found.');
  // Must actually be a member — otherwise a stranger could inject a system
  // message into (and bump) a group they don't belong to.
  if (!chat.participants.some((p) => String(p.user) === String(req.user._id))) {
    throw new ApiError(403, 'You are not a member of this group.');
  }
  const priorParticipants = chat.participants.map((p) => p.user);
  chat.participants = chat.participants.filter((p) => String(p.user) !== String(req.user._id));
  if (chat.participants.length === 0) {
    await chat.deleteOne();
    await invalidateChatListCache(priorParticipants);
    return res.json({ success: true, deleted: true });
  }
  // If the owner left, promote the earliest-joined member.
  if (!chat.participants.some((p) => p.role === 'owner')) chat.participants[0].role = 'owner';
  await chat.save();
  await systemMessage(chat._id, `${req.user.name} left the group`, 'member_left');
  await invalidateChatListCache(priorParticipants);
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
  await invalidateChatListCache(chat.participants.map((p) => p.user));
  chat.participants.forEach((p) => emitToUser(String(p.user), 'chat-updated', { chatId: String(chat._id) }));
  res.json({ success: true, chat: populated });
});

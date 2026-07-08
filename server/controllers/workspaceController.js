import Workspace, { generateInviteCode } from '../models/Workspace.js';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import { createWorkspaceForUser } from '../utils/workspaceService.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

const MEMBER_FIELDS = 'name username avatar isOnline lastSeen workspaceRole accountStatus createdAt';

const isManager = (user) => ['owner', 'admin'].includes(user.workspaceRole);

function publicWorkspace(ws, { includeInvite = false } = {}) {
  return {
    _id: ws._id,
    name: ws.name,
    slug: ws.slug,
    type: ws.type || 'team',
    plan: ws.plan,
    owner: ws.owner,
    createdAt: ws.createdAt,
    ...(includeInvite
      ? {
          inviteCode: ws.inviteCode,
          inviteLink: `${(process.env.CLIENT_URL || '').replace(/\/+$/, '')}/signup?invite=${ws.inviteCode}`,
        }
      : {}),
  };
}

// GET /api/workspaces/me — my workspace + members (invite code only for managers)
export const getMyWorkspace = asyncHandler(async (req, res) => {
  const ws = await Workspace.findById(req.user.workspace);
  if (!ws) throw new ApiError(404, 'You are not in a workspace yet.');
  // The shared Personal space is NOT a team: never expose its (potentially huge)
  // member roster — that would leak every personal user as a browsable directory.
  const isPersonal = ws.type === 'personal';
  const members = isPersonal
    ? []
    : await User.find({ workspace: ws._id }).select(MEMBER_FIELDS).sort({ createdAt: 1 });
  res.json({
    success: true,
    workspace: publicWorkspace(ws, { includeInvite: !isPersonal && isManager(req.user) }),
    myRole: req.user.workspaceRole,
    members,
    memberCount: isPersonal ? undefined : members.length,
  });
});

// PATCH /api/workspaces/me — rename (owner/admin)
export const updateWorkspace = asyncHandler(async (req, res) => {
  if (!isManager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can change settings.');
  const ws = await Workspace.findById(req.user.workspace);
  if (!ws) throw new ApiError(404, 'No workspace.');
  if (typeof req.body.name === 'string' && req.body.name.trim()) ws.name = req.body.name.trim().slice(0, 80);
  await ws.save();
  res.json({ success: true, workspace: publicWorkspace(ws, { includeInvite: true }) });
});

// POST /api/workspaces/me/invite/rotate — new invite code (owner/admin)
export const rotateInvite = asyncHandler(async (req, res) => {
  if (!isManager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can rotate the invite.');
  const ws = await Workspace.findById(req.user.workspace);
  if (!ws) throw new ApiError(404, 'No workspace.');
  for (let i = 0; i < 5; i += 1) {
    ws.inviteCode = generateInviteCode();
    try {
      // eslint-disable-next-line no-await-in-loop
      await ws.save();
      break;
    } catch (err) {
      if (err?.code === 11000 && i < 4) continue;
      throw err;
    }
  }
  res.json({ success: true, workspace: publicWorkspace(ws, { includeInvite: true }) });
});

// PATCH /api/workspaces/me/members/:userId/role — owner/admin sets a member's org role
export const setMemberRole = asyncHandler(async (req, res) => {
  if (!isManager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can change roles.');
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) throw new ApiError(400, 'Role must be admin or member.');
  const member = await User.findOne({ _id: req.params.userId, workspace: req.user.workspace });
  if (!member) throw new ApiError(404, 'Member not found in this workspace.');
  if (member.workspaceRole === 'owner') throw new ApiError(400, "The owner's role can't be changed.");
  member.workspaceRole = role;
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, member: { _id: member._id, workspaceRole: member.workspaceRole } });
});

// PATCH /api/workspaces/me/members/:userId/status — pause/reactivate a member (owner/admin)
// "Pause" suspends the member's access and revokes their live sessions; setting
// 'active' lifts it. In this one-workspace-per-user model, this is the owner's
// lever to temporarily block someone without deleting their account.
export const setMemberStatus = asyncHandler(async (req, res) => {
  if (!isManager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can change member access.');
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) throw new ApiError(400, 'Status must be active or suspended.');
  if (String(req.params.userId) === String(req.user._id)) {
    throw new ApiError(400, "You can't change your own access here.");
  }
  const member = await User.findOne({ _id: req.params.userId, workspace: req.user.workspace });
  if (!member) throw new ApiError(404, 'Member not found in this workspace.');
  if (member.workspaceRole === 'owner') throw new ApiError(400, "The workspace owner can't be paused.");
  // A platform-level ban outranks a workspace owner — don't let them lift it.
  if (member.accountStatus === 'banned') throw new ApiError(403, 'This account is banned at the platform level.');
  member.accountStatus = status;
  if (status !== 'active') member.tokenVersion = (member.tokenVersion || 0) + 1; // kill live sessions now
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, member: { _id: member._id, accountStatus: member.accountStatus } });
});

// DELETE /api/workspaces/me/members/:userId — remove a member from the workspace (owner/admin)
// Ejects them: pulled from this workspace's group chats and moved to a fresh
// personal workspace of their own, with sessions revoked so it takes effect at once.
export const removeMember = asyncHandler(async (req, res) => {
  if (!isManager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can remove members.');
  if (String(req.params.userId) === String(req.user._id)) {
    throw new ApiError(400, "You can't remove yourself. Transfer ownership or delete your account instead.");
  }
  const member = await User.findOne({ _id: req.params.userId, workspace: req.user.workspace });
  if (!member) throw new ApiError(404, 'Member not found in this workspace.');
  if (member.workspaceRole === 'owner') throw new ApiError(400, "The workspace owner can't be removed.");

  const oldWorkspace = req.user.workspace;
  // Stop them receiving this workspace's group messages.
  await Chat.updateMany(
    { workspace: oldWorkspace, isGroup: true, 'participants.user': member._id },
    { $pull: { participants: { user: member._id } } }
  );
  // Give them their own empty workspace and revoke sessions (forces a re-login).
  await createWorkspaceForUser(member, `${member.name}'s workspace`);
  await User.updateOne({ _id: member._id }, { $inc: { tokenVersion: 1 } });
  res.json({ success: true, message: 'Member removed from the workspace.' });
});

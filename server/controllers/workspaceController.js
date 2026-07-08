import Workspace, { generateInviteCode } from '../models/Workspace.js';
import User from '../models/User.js';
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

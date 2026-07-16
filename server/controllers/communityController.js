import Community from '../models/Community.js';
import Chat from '../models/Chat.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

const isMember = (c, uid) => c.members.some((m) => String(m.user) === String(uid));
const isAdmin = (c, uid) => c.members.some((m) => String(m.user) === String(uid) && m.role === 'admin');

function publicCommunity(c, uid) {
  const admin = isAdmin(c, uid);
  return {
    _id: c._id,
    name: c.name,
    description: c.description,
    avatar: c.avatar,
    workspace: c.workspace,
    announcementGroup: c.announcementGroup,
    memberCount: c.members.length,
    groupCount: c.groups.length,
    isAdmin: admin,
    ...(admin ? { inviteCode: c.inviteCode } : {}),
  };
}

// POST /api/communities  { name, description }
export const createCommunity = asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'A community needs a name.');

  // Every community gets an admins-only Announcements group that all members see.
  const announcement = await Chat.create({
    isGroup: true,
    name: `${name} Announcements`,
    description: 'Community-wide announcements',
    workspace: req.user.workspace || null,
    createdBy: req.user._id,
    messagingPolicy: 'admins',
    participants: [{ user: req.user._id, role: 'owner' }],
  });

  const community = await Community.create({
    name,
    description: (req.body.description || '').slice(0, 500),
    workspace: req.user.workspace || null,
    createdBy: req.user._id,
    members: [{ user: req.user._id, role: 'admin' }],
    groups: [announcement._id],
    announcementGroup: announcement._id,
  });

  res.status(201).json({ success: true, community: publicCommunity(community, req.user._id) });
});

// GET /api/communities  — communities I belong to
export const listCommunities = asyncHandler(async (req, res) => {
  const communities = await Community.find({ 'members.user': req.user._id }).sort({ updatedAt: -1 });
  res.json({ success: true, communities: communities.map((c) => publicCommunity(c, req.user._id)) });
});

// GET /api/communities/:id  — details + linked groups (members only)
export const getCommunity = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id).populate({
    path: 'groups',
    select: 'name avatar messagingPolicy participants',
  });
  if (!community) throw new ApiError(404, 'Community not found.');
  if (!isMember(community, req.user._id)) throw new ApiError(403, 'You are not a member of this community.');

  const groups = (community.groups || []).map((g) => ({
    _id: g._id,
    name: g.name,
    avatar: g.avatar,
    isAnnouncement: String(g._id) === String(community.announcementGroup),
    memberCount: (g.participants || []).length,
  }));
  res.json({ success: true, community: { ...publicCommunity(community, req.user._id), groups } });
});

// POST /api/communities/:id/groups  { name }  — create a new group inside the community (admin)
export const addGroupToCommunity = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw new ApiError(404, 'Community not found.');
  if (!isAdmin(community, req.user._id)) throw new ApiError(403, 'Only community admins can add groups.');
  const name = (req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'Group name is required.');

  const chat = await Chat.create({
    isGroup: true,
    name,
    workspace: community.workspace || null,
    createdBy: req.user._id,
    participants: [{ user: req.user._id, role: 'owner' }],
  });
  community.groups.push(chat._id);
  await community.save();
  res.status(201).json({ success: true, chat: { _id: chat._id, name: chat.name } });
});

// POST /api/communities/join/:inviteCode  — join a community
export const joinCommunity = asyncHandler(async (req, res) => {
  const community = await Community.findOne({ inviteCode: req.params.inviteCode });
  if (!community) throw new ApiError(404, 'That community invite is invalid.');
  if (!isMember(community, req.user._id)) {
    community.members.push({ user: req.user._id, role: 'member' });
    await community.save();
    // Add them to the announcement group so they receive community posts.
    await Chat.updateOne(
      { _id: community.announcementGroup, 'participants.user': { $ne: req.user._id } },
      { $push: { participants: { user: req.user._id, role: 'member' } } }
    );
  }
  res.json({ success: true, community: publicCommunity(community, req.user._id) });
});

// POST /api/communities/:id/leave
export const leaveCommunity = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw new ApiError(404, 'Community not found.');
  community.members = community.members.filter((m) => String(m.user) !== String(req.user._id));
  await community.save();
  await Chat.updateOne(
    { _id: community.announcementGroup },
    { $pull: { participants: { user: req.user._id } } }
  );
  res.json({ success: true });
});

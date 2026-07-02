import Status from '../models/Status.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const USER_FIELDS = 'name username avatar';

/** Only the owner or a contact of the owner may view/reply to a status. */
async function assertAudience(status, userId) {
  if (String(status.user) === String(userId)) return;
  const owner = await User.findById(status.user).select('contacts');
  const isContact = (owner?.contacts || []).some((c) => String(c) === String(userId));
  if (!isContact) throw new ApiError(403, 'You are not allowed to see this status.');
}

// POST /api/status
export const createStatus = asyncHandler(async (req, res) => {
  const { type = 'text', content, media, background, privacy } = req.body;
  const status = await Status.create({
    user: req.user._id,
    type,
    content,
    media,
    background,
    privacy: privacy || undefined,
  });
  res.status(201).json({ success: true, status });
});

// GET /api/status  — my status + contacts' statuses, grouped by user
export const getStatusFeed = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id);
  const audience = [req.user._id, ...me.contacts];
  const statuses = await Status.find({ user: { $in: audience } })
    .sort({ createdAt: -1 })
    .populate('user', USER_FIELDS)
    .populate('viewers.user', USER_FIELDS);

  // Group by user
  const grouped = {};
  for (const s of statuses) {
    const uid = String(s.user._id);
    if (!grouped[uid]) grouped[uid] = { user: s.user, items: [], seenAll: false };
    grouped[uid].items.push(s);
  }
  res.json({ success: true, feed: Object.values(grouped) });
});

// POST /api/status/:id/view
export const viewStatus = asyncHandler(async (req, res) => {
  const status = await Status.findById(req.params.id);
  if (!status) throw new ApiError(404, 'Status not found.');
  await assertAudience(status, req.user._id);
  if (!status.viewers.some((v) => String(v.user) === String(req.user._id))) {
    status.viewers.push({ user: req.user._id, at: new Date() });
    await status.save();
  }
  res.json({ success: true });
});

// POST /api/status/:id/reply  { text }
export const replyStatus = asyncHandler(async (req, res) => {
  const status = await Status.findById(req.params.id);
  if (!status) throw new ApiError(404, 'Status not found.');
  await assertAudience(status, req.user._id);
  status.replies.push({ user: req.user._id, text: req.body.text });
  await status.save();
  emitToUser(String(status.user), 'status-reply', { from: req.user.name, text: req.body.text });
  res.json({ success: true });
});

// GET /api/status/:id/viewers
export const getViewers = asyncHandler(async (req, res) => {
  const status = await Status.findById(req.params.id).populate('viewers.user', USER_FIELDS);
  if (!status) throw new ApiError(404, 'Status not found.');
  if (String(status.user) !== String(req.user._id)) throw new ApiError(403, 'Not your status.');
  res.json({ success: true, viewers: status.viewers });
});

// DELETE /api/status/:id
export const deleteStatus = asyncHandler(async (req, res) => {
  const status = await Status.findById(req.params.id);
  if (!status) throw new ApiError(404, 'Status not found.');
  if (String(status.user) !== String(req.user._id)) throw new ApiError(403, 'Not your status.');
  await status.deleteOne();
  res.json({ success: true });
});

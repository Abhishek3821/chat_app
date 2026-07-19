import Status from '../models/Status.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const USER_FIELDS = 'name username avatar';

/**
 * Whether `viewerId` may see `status`, given the owner's contact list.
 * Honours the per-status privacy audience:
 *   everyone  → any contact of the owner
 *   contacts  → any contact of the owner (default)
 *   selected  → only ids listed in privacy.allow
 *   except    → contacts, minus ids listed in privacy.except
 * (Feed visibility is always at most "contacts" — we never expose a status to a
 * non-contact even for type 'everyone', matching the app's consent model.)
 */
/**
 * Realtime fan-out: tell every contact allowed by this status's audience that
 * the owner's status list changed, so their Status feed updates live instead of
 * on next refresh. Payload is just a hint (no content) — clients refetch the
 * feed, which re-applies all privacy rules server-side.
 */
async function notifyStatusAudience(status, ownerId) {
  try {
    const owner = await User.findById(ownerId).select('contacts');
    const p = status?.privacy || {};
    let targets = (owner?.contacts || []).map((c) => String(c));
    if (p.type === 'selected') targets = targets.filter((id) => (p.allow || []).some((a) => String(a) === id));
    else if (p.type === 'except') targets = targets.filter((id) => !(p.except || []).some((e) => String(e) === id));
    for (const t of targets) emitToUser(t, 'status-updated', { userId: String(ownerId) });
  } catch {
    /* fan-out is best-effort */
  }
}

function canView(status, ownerContacts, viewerId) {
  if (String(status.user?._id || status.user) === String(viewerId)) return true;
  const isContact = (ownerContacts || []).some((c) => String(c) === String(viewerId));
  if (!isContact) return false;
  const p = status.privacy || {};
  if (p.type === 'selected') return (p.allow || []).some((id) => String(id) === String(viewerId));
  if (p.type === 'except') return !(p.except || []).some((id) => String(id) === String(viewerId));
  return true; // 'everyone' | 'contacts' | unset
}

/** Only the owner, or a contact allowed by the status's privacy audience, may view/reply. */
export async function assertAudience(status, userId) {
  if (String(status.user) === String(userId)) return;
  const owner = await User.findById(status.user).select('contacts');
  if (!canView(status, owner?.contacts, userId)) {
    throw new ApiError(403, 'You are not allowed to see this status.');
  }
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
  notifyStatusAudience(status, req.user._id); // live update for contacts (no await — response first)
  res.status(201).json({ success: true, status });
});

// GET /api/status  — my status + contacts' statuses, grouped by user
export const getStatusFeed = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('contacts');
  const myId = String(req.user._id);
  const audience = [req.user._id, ...me.contacts];
  const statuses = await Status.find({ user: { $in: audience } })
    .sort({ createdAt: -1 })
    .populate('user', USER_FIELDS)
    .populate('viewers.user', USER_FIELDS);

  // Owners of statuses in this feed are all contacts of mine; whether *I* pass
  // each status's own audience is what canView decides. My contact list is the
  // relevant one for MY statuses; for a contact's status, contact-ship is already
  // implied by them being in `audience`, so their privacy.allow/except govern.
  const grouped = {};
  for (const s of statuses) {
    const isMine = String(s.user._id) === myId;
    // For a contact's status, evaluate its per-status audience against me. We
    // pass a single-element "contacts" proxy since contact-ship already holds.
    if (!isMine && !canView(s, [myId], myId)) continue;

    const obj = s.toObject();
    // PRIVACY: only the status OWNER may see who viewed it. Strip the viewer
    // list (and reply authors) from other people's statuses in the feed.
    if (!isMine) {
      delete obj.viewers;
      delete obj.replies;
    }
    const uid = String(s.user._id);
    if (!grouped[uid]) grouped[uid] = { user: s.user, items: [], seenAll: false };
    grouped[uid].items.push(obj);
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
  notifyStatusAudience(status, req.user._id); // contacts drop it from their feed live
  res.json({ success: true });
});

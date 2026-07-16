import Label from '../models/Label.js';
import QuickReply from '../models/QuickReply.js';
import Chat from '../models/Chat.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { workspaceCan, PERMISSIONS } from '../utils/rbac.js';

// Defining labels / quick replies is a manager capability; applying labels and
// using quick replies is available to any member (agent) of the workspace.
const canManage = (user) => workspaceCan(user, PERMISSIONS.WORKSPACE_SETTINGS);
const requireWorkspace = (user) => {
  if (!user.workspace) throw new ApiError(400, 'You are not in a workspace.');
  return user.workspace;
};

// ── Labels ───────────────────────────────────────────────────────
// GET /api/agent/labels
export const listLabels = asyncHandler(async (req, res) => {
  if (!req.user.workspace) return res.json({ success: true, labels: [], canManage: false });
  const labels = await Label.find({ workspace: req.user.workspace }).sort({ createdAt: 1 });
  res.json({ success: true, labels, canManage: canManage(req.user) });
});

// POST /api/agent/labels  { name, color }
export const createLabel = asyncHandler(async (req, res) => {
  const workspace = requireWorkspace(req.user);
  if (!canManage(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage labels.');
  const name = (req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'A label needs a name.');
  try {
    const label = await Label.create({
      workspace,
      name: name.slice(0, 40),
      color: (req.body.color || '#6366f1').slice(0, 20),
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, label });
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, 'A label with that name already exists.');
    throw err;
  }
});

// DELETE /api/agent/labels/:id
export const deleteLabel = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage labels.');
  const result = await Label.deleteOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!result.deletedCount) throw new ApiError(404, 'Label not found.');
  await Chat.updateMany({ labels: req.params.id }, { $pull: { labels: req.params.id } });
  res.json({ success: true });
});

// POST /api/agent/labels/:id/apply  { chatId }  — tag a chat (any workspace member)
export const applyLabel = asyncHandler(async (req, res) => {
  const label = await Label.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!label) throw new ApiError(404, 'Label not found.');
  const chat = await Chat.findById(req.body.chatId);
  if (!chat || !chat.participants.some((p) => String(p.user) === String(req.user._id))) {
    throw new ApiError(403, 'You are not a participant of this chat.');
  }
  const apply = req.body.apply !== false; // apply by default; pass apply:false to remove
  await Chat.updateOne(
    { _id: chat._id },
    apply ? { $addToSet: { labels: label._id } } : { $pull: { labels: label._id } }
  );
  res.json({ success: true, applied: apply });
});

// GET /api/agent/labels/chat/:chatId — labels applied to a chat (my workspace's only)
export const getChatLabels = asyncHandler(async (req, res) => {
  const chat = await Chat.findById(req.params.chatId).select('participants labels');
  if (!chat || !chat.participants.some((p) => String(p.user) === String(req.user._id))) {
    throw new ApiError(403, 'You are not a participant of this chat.');
  }
  const labels = await Label.find({ _id: { $in: chat.labels || [] }, workspace: req.user.workspace });
  res.json({ success: true, labels });
});

// ── Quick replies ────────────────────────────────────────────────
// GET /api/agent/quick-replies
export const listQuickReplies = asyncHandler(async (req, res) => {
  if (!req.user.workspace) return res.json({ success: true, quickReplies: [], canManage: false });
  const quickReplies = await QuickReply.find({ workspace: req.user.workspace }).sort({ shortcut: 1 });
  res.json({ success: true, quickReplies, canManage: canManage(req.user) });
});

// POST /api/agent/quick-replies  { shortcut, text }
export const createQuickReply = asyncHandler(async (req, res) => {
  const workspace = requireWorkspace(req.user);
  if (!canManage(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage quick replies.');
  const shortcut = (req.body.shortcut || '').trim().replace(/^\/+/, '');
  const text = (req.body.text || '').trim();
  if (!shortcut || !text) throw new ApiError(400, 'A quick reply needs a shortcut and text.');
  try {
    const quickReply = await QuickReply.create({
      workspace,
      shortcut: shortcut.slice(0, 40),
      text: text.slice(0, 2000),
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, quickReply });
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, 'A quick reply with that shortcut already exists.');
    throw err;
  }
});

// PATCH /api/agent/quick-replies/:id
export const updateQuickReply = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage quick replies.');
  const quickReply = await QuickReply.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!quickReply) throw new ApiError(404, 'Quick reply not found.');
  if (typeof req.body.shortcut === 'string' && req.body.shortcut.trim()) {
    quickReply.shortcut = req.body.shortcut.trim().replace(/^\/+/, '').slice(0, 40);
  }
  if (typeof req.body.text === 'string' && req.body.text.trim()) quickReply.text = req.body.text.slice(0, 2000);
  try {
    await quickReply.save();
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, 'A quick reply with that shortcut already exists.');
    throw err;
  }
  res.json({ success: true, quickReply });
});

// DELETE /api/agent/quick-replies/:id
export const deleteQuickReply = asyncHandler(async (req, res) => {
  if (!canManage(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage quick replies.');
  const result = await QuickReply.deleteOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!result.deletedCount) throw new ApiError(404, 'Quick reply not found.');
  res.json({ success: true });
});

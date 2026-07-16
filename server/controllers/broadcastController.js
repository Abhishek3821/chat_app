import BroadcastList from '../models/BroadcastList.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const RECIPIENT_FIELDS = 'name username avatar isOnline';
const MAX_RECIPIENTS = 256;

/** Keep only ids that are mutual contacts of the owner (WhatsApp rule: you can
 *  only broadcast to people who have you saved as a contact too). */
async function keepMutualContacts(owner, ids) {
  const unique = [...new Set(ids.map(String))].filter((id) => id !== String(owner._id));
  const mine = new Set((owner.contacts || []).map(String));
  const candidates = unique.filter((id) => mine.has(id));
  if (!candidates.length) return [];
  const them = await User.find({ _id: { $in: candidates } }).select('contacts');
  return them.filter((u) => (u.contacts || []).some((c) => String(c) === String(owner._id))).map((u) => u._id);
}

async function getOrCreateDirectChat(meId, otherId) {
  let chat = await Chat.findOne({
    isGroup: false,
    'participants.user': { $all: [meId, otherId] },
    $expr: { $eq: [{ $size: '$participants' }, 2] },
  });
  if (!chat) {
    chat = await Chat.create({ isGroup: false, workspace: null, participants: [{ user: meId }, { user: otherId }] });
  }
  return chat;
}

function publicList(l) {
  return { _id: l._id, name: l.name, recipients: l.recipients, recipientCount: (l.recipients || []).length, createdAt: l.createdAt };
}

// GET /api/broadcasts
export const listBroadcasts = asyncHandler(async (req, res) => {
  const lists = await BroadcastList.find({ owner: req.user._id }).populate('recipients', RECIPIENT_FIELDS).sort({ updatedAt: -1 });
  res.json({ success: true, lists: lists.map(publicList) });
});

// POST /api/broadcasts  { name, recipients: [userId] }
export const createBroadcast = asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'A broadcast list needs a name.');
  const ids = Array.isArray(req.body.recipients) ? req.body.recipients.slice(0, MAX_RECIPIENTS) : [];
  const recipients = await keepMutualContacts(req.user, ids);
  let list = await BroadcastList.create({ owner: req.user._id, name: name.slice(0, 80), recipients });
  list = await list.populate('recipients', RECIPIENT_FIELDS);
  res.status(201).json({ success: true, list: publicList(list) });
});

// PATCH /api/broadcasts/:id  { name, recipients }
export const updateBroadcast = asyncHandler(async (req, res) => {
  const list = await BroadcastList.findOne({ _id: req.params.id, owner: req.user._id });
  if (!list) throw new ApiError(404, 'Broadcast list not found.');
  if (typeof req.body.name === 'string' && req.body.name.trim()) list.name = req.body.name.trim().slice(0, 80);
  if (Array.isArray(req.body.recipients)) {
    list.recipients = await keepMutualContacts(req.user, req.body.recipients.slice(0, MAX_RECIPIENTS));
  }
  await list.save();
  await list.populate('recipients', RECIPIENT_FIELDS);
  res.json({ success: true, list: publicList(list) });
});

// DELETE /api/broadcasts/:id
export const deleteBroadcast = asyncHandler(async (req, res) => {
  const result = await BroadcastList.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (!result.deletedCount) throw new ApiError(404, 'Broadcast list not found.');
  res.json({ success: true });
});

// POST /api/broadcasts/:id/send  { content, type, attachments }
// Delivers the message individually to each recipient's own 1:1 chat.
export const sendBroadcast = asyncHandler(async (req, res) => {
  const list = await BroadcastList.findOne({ _id: req.params.id, owner: req.user._id });
  if (!list) throw new ApiError(404, 'Broadcast list not found.');
  const content = typeof req.body.content === 'string' ? req.body.content : '';
  const type = ['text', 'image', 'video', 'document'].includes(req.body.type) ? req.body.type : 'text';
  const attachments = Array.isArray(req.body.attachments)
    ? req.body.attachments.filter((a) => a && typeof a.url === 'string' && (a.url.startsWith('/uploads/') || /^https:\/\//i.test(a.url))).slice(0, 20)
    : [];
  if (!content && attachments.length === 0) throw new ApiError(400, 'Broadcast message cannot be empty.');

  // Re-validate recipients at send-time (a contact may have been removed since).
  const recipients = await keepMutualContacts(req.user, (list.recipients || []).map(String));
  let sent = 0;
  for (const recipientId of recipients) {
    // eslint-disable-next-line no-await-in-loop
    const chat = await getOrCreateDirectChat(req.user._id, recipientId);
    // eslint-disable-next-line no-await-in-loop
    let message = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      type,
      content,
      attachments,
      deliveredTo: [req.user._id],
      readBy: [{ user: req.user._id, at: new Date() }],
    });
    chat.lastMessage = message._id;
    // eslint-disable-next-line no-await-in-loop
    await chat.save();
    // eslint-disable-next-line no-await-in-loop
    message = await Message.findById(message._id).populate('sender', 'name username avatar');
    emitToUser(String(recipientId), 'receive-message', { chatId: String(chat._id), message });
    emitToUser(String(recipientId), 'chat-updated', { chatId: String(chat._id) });
    emitToUser(String(req.user._id), 'chat-updated', { chatId: String(chat._id) });
    sent += 1;
  }
  res.json({ success: true, sent, skipped: (list.recipients || []).length - sent });
});

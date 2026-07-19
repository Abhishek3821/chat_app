import crypto from 'crypto';
import IncomingWebhook from '../models/IncomingWebhook.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';
import { notifyUser } from '../utils/notify.js';
import { securityEvent } from '../utils/securityLog.js';

const SENDER_FIELDS = 'name username avatar';

/** Only a member of the (group) chat may manage its webhooks. */
async function assertGroupMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw new ApiError(404, 'Chat not found.');
  if (!chat.isGroup) throw new ApiError(400, 'Webhooks are only for group chats.');
  if (!chat.participants.some((p) => String(p.user) === String(userId))) {
    throw new ApiError(403, 'You are not a member of this group.');
  }
  return chat;
}

// GET /api/webhooks — my webhooks across the groups I'm in.
export const listWebhooks = asyncHandler(async (req, res) => {
  const myChats = await Chat.find({ isGroup: true, 'participants.user': req.user._id }).select('_id name');
  const ids = myChats.map((c) => c._id);
  const hooks = await IncomingWebhook.find({ chat: { $in: ids } }).sort({ createdAt: -1 });
  const nameOf = new Map(myChats.map((c) => [String(c._id), c.name]));
  res.json({
    success: true,
    webhooks: hooks.map((h) => ({
      id: h._id,
      label: h.label,
      chatId: String(h.chat),
      chatName: nameOf.get(String(h.chat)) || 'Group',
      url: `/api/hooks/${h.token}`,
      active: h.active,
      lastUsedAt: h.lastUsedAt,
      createdAt: h.createdAt,
    })),
  });
});

// POST /api/webhooks  { chatId, label } — mint a webhook for a group I'm in.
export const createWebhook = asyncHandler(async (req, res) => {
  const { chatId, label } = req.body;
  const chat = await assertGroupMember(chatId, req.user._id);
  const token = crypto.randomBytes(24).toString('base64url');
  const hook = await IncomingWebhook.create({
    token,
    chat: chat._id,
    workspace: chat.workspace,
    createdBy: req.user._id,
    label: String(label || 'Webhook').slice(0, 60),
  });
  securityEvent('webhook.created', req, { webhookId: String(hook._id), chatId: String(chat._id) });
  res.status(201).json({
    success: true,
    message: 'Store this URL — anyone with it can post to the group.',
    webhook: { id: hook._id, label: hook.label, chatId: String(chat._id), url: `/api/hooks/${token}` },
  });
});

// DELETE /api/webhooks/:id — revoke one of my group's webhooks.
export const deleteWebhook = asyncHandler(async (req, res) => {
  const hook = await IncomingWebhook.findById(req.params.id);
  if (!hook) throw new ApiError(404, 'Webhook not found.');
  await assertGroupMember(hook.chat, req.user._id); // membership gate
  await hook.deleteOne();
  securityEvent('webhook.revoked', req, { webhookId: String(hook._id) });
  res.json({ success: true, message: 'Webhook revoked.' });
});

// POST /api/hooks/:token  { text }  — PUBLIC (the token is the credential).
// Posts an external message into the webhook's group chat.
export const receiveWebhook = asyncHandler(async (req, res) => {
  const hook = await IncomingWebhook.findOne({ token: req.params.token, active: true });
  if (!hook) throw new ApiError(404, 'Unknown webhook.');
  // Accept { text } or Slack-style { text }/plain string bodies.
  const raw = typeof req.body === 'string' ? req.body : req.body?.text || req.body?.content || '';
  const text = String(raw || '').trim().slice(0, 4000);
  if (!text) throw new ApiError(400, 'A "text" field is required.');

  const chat = await Chat.findById(hook.chat);
  if (!chat) throw new ApiError(404, 'The target chat no longer exists.');

  let message = await Message.create({
    chat: chat._id,
    sender: hook.createdBy, // attributed to the creator, tagged as the webhook
    content: `[${hook.label}] ${text}`,
    type: 'text',
  });
  chat.lastMessage = message._id;
  await chat.save();
  hook.lastUsedAt = new Date();
  await hook.save();

  message = await Message.findById(message._id).populate('sender', SENDER_FIELDS);
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId: String(chat._id), message });
    if (String(p.user) !== String(hook.createdBy)) {
      emitToUser(String(p.user), 'chat-updated', { chatId: String(chat._id) });
      notifyUser(p.user, {
        from: hook.createdBy,
        type: 'group_message',
        title: chat.name || 'Group',
        body: `${hook.label}: ${text.slice(0, 120)}`,
        tag: `chat:${chat._id}`,
        url: `/?chat=${chat._id}`,
        data: { chatId: String(chat._id) },
      });
    }
  }
  res.json({ success: true });
});

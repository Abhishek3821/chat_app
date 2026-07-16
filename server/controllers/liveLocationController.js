import Message from '../models/Message.js';
import Chat from '../models/Chat.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser, emitToChat } from '../socket/index.js';

const MAX_DURATION = 60 * 60 * 8; // 8 hours, like WhatsApp's longest option

const isCoord = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

async function assertMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw new ApiError(404, 'Chat not found.');
  if (!chat.participants.some((p) => String(p.user) === String(userId))) {
    throw new ApiError(403, 'You are not a participant of this chat.');
  }
  return chat;
}

// POST /api/live-location/start  { chatId, lat, lng, durationSecs }
// Anchors a live-location message in the chat that updates until it expires.
export const startLiveLocation = asyncHandler(async (req, res) => {
  const { chatId, lat, lng } = req.body;
  if (!isCoord(lat, 90) || !isCoord(lng, 180)) throw new ApiError(400, 'Valid lat/lng are required.');
  const chat = await assertMember(chatId, req.user._id);
  const durationSecs = Math.max(60, Math.min(Math.floor(Number(req.body.durationSecs) || 3600), MAX_DURATION));
  const expiresAt = new Date(Date.now() + durationSecs * 1000);

  let message = await Message.create({
    chat: chatId,
    sender: req.user._id,
    type: 'location',
    location: { lat, lng, label: 'Live location' },
    liveLocation: { active: true, expiresAt },
    deliveredTo: [req.user._id],
    readBy: [{ user: req.user._id, at: new Date() }],
  });
  chat.lastMessage = message._id;
  await chat.save();
  message = await Message.findById(message._id).populate('sender', 'name username avatar');
  for (const p of chat.participants) {
    emitToUser(String(p.user), 'receive-message', { chatId: String(chatId), message });
    if (String(p.user) !== String(req.user._id)) emitToUser(String(p.user), 'chat-updated', { chatId: String(chatId) });
  }
  res.status(201).json({ success: true, message });
});

// POST /api/live-location/:messageId/update  { lat, lng } — sharer only, realtime
export const updateLiveLocation = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;
  if (!isCoord(lat, 90) || !isCoord(lng, 180)) throw new ApiError(400, 'Valid lat/lng are required.');
  const message = await Message.findById(req.params.messageId);
  if (!message || !message.liveLocation?.active) throw new ApiError(404, 'Live location not found or already ended.');
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'Only the sharer can update this location.');
  if (message.liveLocation.expiresAt && message.liveLocation.expiresAt <= new Date()) {
    message.liveLocation.active = false;
    await message.save();
    throw new ApiError(410, 'This live location has expired.');
  }
  message.location = { lat, lng, label: 'Live location' };
  await message.save();
  // High-frequency: emit a light-weight update rather than the whole message.
  emitToChat(String(message.chat), 'live-location', {
    chatId: String(message.chat),
    messageId: String(message._id),
    userId: String(req.user._id),
    lat,
    lng,
  });
  res.json({ success: true });
});

// POST /api/live-location/:messageId/stop — sharer stops sharing early
export const stopLiveLocation = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) throw new ApiError(404, 'Live location not found.');
  if (String(message.sender) !== String(req.user._id)) throw new ApiError(403, 'Only the sharer can stop this location.');
  message.liveLocation.active = false;
  await message.save();
  emitToChat(String(message.chat), 'live-location-stopped', { chatId: String(message.chat), messageId: String(message._id) });
  res.json({ success: true });
});

// GET /api/live-location/:chatId/active — currently-live shares in a chat
export const getActiveLiveLocations = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);
  const messages = await Message.find({
    chat: req.params.chatId,
    'liveLocation.active': true,
    'liveLocation.expiresAt': { $gt: new Date() },
  })
    .select('sender location liveLocation')
    .populate('sender', 'name username avatar');
  res.json({ success: true, liveLocations: messages });
});

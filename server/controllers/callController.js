import Call from '../models/Call.js';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser, isUserOnline } from '../socket/index.js';
import { transitionCall } from '../utils/callService.js';
import { notifyUser } from '../utils/notify.js';

const USER_FIELDS = 'name username avatar isOnline';

/** Both users must have accepted each other as contacts. */
async function assertMutualContacts(meId, otherId) {
  const [me, other] = await Promise.all([
    User.findById(meId).select('contacts'),
    User.findById(otherId).select('contacts'),
  ]);
  if (!other) throw new ApiError(404, 'User not found.');
  const mutual =
    (me.contacts || []).some((c) => String(c) === String(otherId)) &&
    (other.contacts || []).some((c) => String(c) === String(meId));
  if (!mutual) throw new ApiError(403, 'You can only call your contacts.');
  return other;
}

// POST /api/calls/start  { receiverId, callType: 'audio'|'video' }
// Creates the 1:1 call record BEFORE signaling rings the callee, and tells the
// caller whether the receiver is even online (offline → logged as missed).
export const startDirectCall = asyncHandler(async (req, res) => {
  const { receiverId } = req.body;
  const type = req.body.callType === 'video' || req.body.type === 'video' ? 'video' : 'audio';
  if (!receiverId) throw new ApiError(400, 'receiverId is required.');
  if (String(receiverId) === String(req.user._id)) throw new ApiError(400, "You can't call yourself.");
  await assertMutualContacts(req.user._id, receiverId);

  const receiverOnline = await isUserOnline(receiverId);
  const call = await Call.create({
    type,
    isGroup: false,
    initiator: req.user._id,
    caller: req.user._id,
    receiver: receiverId,
    participants: [
      { user: req.user._id, status: 'joined', joinedAt: new Date() },
      { user: receiverId, status: 'ringing' },
    ],
    status: receiverOnline ? 'ringing' : 'missed',
    ...(receiverOnline ? {} : { endedAt: new Date() }),
  });

  // Device notification either way: with no live socket the push is the ONLY
  // way a closed app hears the phone ring; online it still wakes a locked screen.
  notifyUser(receiverId, {
    from: req.user._id,
    type: receiverOnline ? 'incoming_call' : 'missed_call',
    title: receiverOnline ? `Incoming ${type} call` : `Missed ${type} call`,
    body: receiverOnline ? `${req.user.name} is calling you…` : `You missed a ${type} call from ${req.user.name}.`,
    tag: `call:${call._id}`,
    url: '/calls',
    data: { callId: String(call._id), callType: type },
  });

  res.status(201).json({ success: true, call, receiverOnline });
});

// POST /api/calls/end  { callId, duration? }
export const endCall = asyncHandler(async (req, res) => {
  const call = await transitionCall(req.body.callId, req.user._id, 'end', { duration: req.body.duration });
  if (!call) throw new ApiError(404, 'Call not found.');
  res.json({ success: true, call });
});

// POST /api/calls/missed  { callId }
export const missCall = asyncHandler(async (req, res) => {
  const call = await transitionCall(req.body.callId, req.user._id, 'missed');
  if (!call) throw new ApiError(404, 'Call not found.');
  // Tell the callee they missed it (caller cancelled / ring timed out).
  if (call.receiver && String(call.receiver) !== String(req.user._id)) {
    notifyUser(call.receiver, {
      from: req.user._id,
      type: 'missed_call',
      title: `Missed ${call.type} call`,
      body: `You missed a ${call.type} call from ${req.user.name}.`,
      tag: `call:${call._id}`,
      url: '/calls',
      data: { callId: String(call._id) },
    });
  }
  res.json({ success: true, call });
});

// POST /api/calls/reject  { callId }
export const rejectCall = asyncHandler(async (req, res) => {
  const call = await transitionCall(req.body.callId, req.user._id, 'reject');
  if (!call) throw new ApiError(404, 'Call not found.');
  res.json({ success: true, call });
});

// POST /api/calls  — legacy/group entry point: log a call and ring the callees
export const startCall = asyncHandler(async (req, res) => {
  const { type = 'audio', chatId, participants = [], isGroup = false } = req.body;
  if (!Array.isArray(participants)) throw new ApiError(400, 'participants must be a list.');

  // SECURITY: you may only ring people you're allowed to reach — group members
  // (for a group call) or mutual contacts (for a 1:1). Anyone else is dropped.
  let allowed;
  if (isGroup && chatId) {
    const chat = await Chat.findOne({ _id: chatId, 'participants.user': req.user._id });
    if (!chat) throw new ApiError(403, 'You are not a member of this group.');
    const memberIds = new Set(chat.participants.map((p) => String(p.user)));
    allowed = participants.map(String).filter((id) => memberIds.has(id));
  } else {
    const me = await User.findById(req.user._id).select('contacts');
    const myContacts = new Set((me.contacts || []).map(String));
    const targets = await User.find({ _id: { $in: participants.map(String).filter((id) => myContacts.has(id)) } }).select('contacts');
    allowed = targets
      .filter((u) => (u.contacts || []).some((c) => String(c) === String(req.user._id)))
      .map((u) => String(u._id));
  }
  if (!allowed.length) throw new ApiError(403, 'No reachable participants for this call.');

  const call = await Call.create({
    type,
    isGroup,
    chat: chatId,
    initiator: req.user._id,
    caller: req.user._id,
    receiver: !isGroup && allowed.length === 1 ? allowed[0] : undefined,
    participants: allowed.map((u) => ({ user: u, status: 'ringing' })),
    status: 'ringing',
  });
  allowed.forEach((uid) => {
    emitToUser(uid, 'call:incoming', {
      callId: String(call._id),
      from: { _id: req.user._id, name: req.user.name, avatar: req.user.avatar },
      type,
      isGroup,
      chatId,
    });
    notifyUser(uid, {
      from: req.user._id,
      type: 'incoming_call',
      title: isGroup ? `Incoming group ${type} call` : `Incoming ${type} call`,
      body: `${req.user.name} is calling you…`,
      tag: `call:${call._id}`,
      url: '/calls',
      data: { callId: String(call._id), callType: type },
    });
  });
  res.status(201).json({ success: true, call });
});

// PATCH /api/calls/:id  — legacy: update status/duration when call ends
export const updateCall = asyncHandler(async (req, res) => {
  const { status, duration } = req.body;
  const call = await Call.findById(req.params.id);
  if (!call) throw new ApiError(404, 'Call not found.');
  // Only the initiator or a ringed participant may mutate a call record.
  const involved =
    String(call.initiator) === String(req.user._id) ||
    call.participants.some((p) => String(p.user) === String(req.user._id));
  if (!involved) throw new ApiError(403, 'You are not part of this call.');
  if (status) call.status = status;
  if (duration != null) call.duration = duration;
  if (['completed', 'missed', 'rejected'].includes(status)) call.endedAt = new Date();
  await call.save();
  res.json({ success: true, call });
});

// GET /api/calls  and  GET /api/calls/history  — call history for the user
export const getCallHistory = asyncHandler(async (req, res) => {
  const me = String(req.user._id);
  const calls = await Call.find({
    $or: [{ initiator: req.user._id }, { 'participants.user': req.user._id }, { receiver: req.user._id }],
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('initiator', USER_FIELDS)
    .populate('caller', USER_FIELDS)
    .populate('receiver', USER_FIELDS)
    .populate('participants.user', USER_FIELDS);

  // Convenience for the client: direction + the "other person" per call.
  const enriched = calls.map((c) => {
    const doc = c.toObject();
    const callerId = String(doc.caller?._id || doc.initiator?._id || '');
    doc.direction = callerId === me ? 'outgoing' : 'incoming';
    const others = [
      doc.caller,
      doc.receiver,
      ...(doc.participants || []).map((p) => p.user),
    ].filter((u) => u && String(u._id) !== me);
    doc.peer = others[0] || doc.initiator || null;
    return doc;
  });

  res.json({ success: true, calls: enriched });
});

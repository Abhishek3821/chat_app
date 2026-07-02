import { verifyToken } from '../utils/token.js';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { transitionCall } from '../utils/callService.js';

let ioRef = null;
/** userId -> Set<socketId> */
const onlineUsers = new Map();

export function getIO() {
  return ioRef;
}

export function isOnline(userId) {
  return onlineUsers.has(String(userId));
}

export function onlineUserIds() {
  return [...onlineUsers.keys()];
}

/** Emit an event to every socket belonging to a user (their personal room). */
export function emitToUser(userId, event, payload) {
  if (!ioRef || !userId) return;
  ioRef.to(`user:${String(userId)}`).emit(event, payload);
}

/** Emit to all participants of a chat except optionally one user. */
export function emitToChat(chatId, event, payload) {
  if (!ioRef || !chatId) return;
  ioRef.to(`chat:${String(chatId)}`).emit(event, payload);
}

async function setPresence(userId, online) {
  try {
    await User.findByIdAndUpdate(userId, {
      isOnline: online,
      ...(online ? {} : { lastSeen: new Date() }),
    });
  } catch {
    /* ignore presence write failures */
  }
}

/** True only if A and B have each accepted the other as a contact. */
async function areMutualContacts(aId, bId) {
  if (!aId || !bId) return false;
  const a = await User.findById(aId).select('contacts');
  if (!a || !(a.contacts || []).some((c) => String(c) === String(bId))) return false;
  const b = await User.findById(bId).select('contacts');
  return !!b && (b.contacts || []).some((c) => String(c) === String(aId));
}

/** True if the user is a participant of the chat. */
async function isChatMember(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId }).select('_id');
    return !!chat;
  } catch {
    return false; // bad ObjectId etc.
  }
}

export function initSocket(io) {
  ioRef = io;

  // Authenticate every socket connection with the JWT and re-check account state,
  // so banned/suspended users and revoked tokens can't hold a live socket open.
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('No auth token'));
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id).select('accountStatus tokenVersion');
      if (!user) return next(new Error('User no longer exists'));
      if (user.accountStatus !== 'active') return next(new Error('Account is not active'));
      if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        return next(new Error('Session revoked'));
      }
      socket.userId = String(user._id);
      next();
    } catch {
      next(new Error('Invalid auth token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.userId);
    socket.join(`user:${userId}`);

    // IMPORTANT: register ALL event listeners synchronously FIRST. Clients emit
    // 'join-chat' the instant they connect; any `await` before this point would
    // let those early events arrive with no listener attached and be dropped.

    // ── Chat rooms ────────────────────────────────────────────────
    // SECURITY: only join a chat room after verifying membership — otherwise any
    // authenticated socket could join `chat:<id>` and passively receive every
    // live message, typing event and read receipt for a conversation it isn't in.
    socket.on('join-chat', async (chatId) => {
      if (chatId && (await isChatMember(chatId, userId))) socket.join(`chat:${chatId}`);
    });
    socket.on('leave-chat', (chatId) => chatId && socket.leave(`chat:${chatId}`));

    // ── Typing indicators ─────────────────────────────────────────
    socket.on('typing-start', ({ chatId }) =>
      socket.to(`chat:${chatId}`).emit('typing-start', { chatId, userId })
    );
    socket.on('typing-stop', ({ chatId }) =>
      socket.to(`chat:${chatId}`).emit('typing-stop', { chatId, userId })
    );

    // ── Read receipts ─────────────────────────────────────────────
    socket.on('message-read', ({ chatId, messageIds }) => {
      socket.to(`chat:${chatId}`).emit('message-read', { chatId, messageIds, userId });
    });

    // ── Live reactions (also persisted via REST) ──────────────────
    socket.on('message-reaction', (payload) => {
      if (payload?.chatId) socket.to(`chat:${payload.chatId}`).emit('message-reaction', payload);
    });

    // ── Delivery / read receipts (persist + broadcast — drives the ticks) ──
    // delivered: the recipient's device received a specific message → ✓✓ (grey)
    socket.on('message:delivered', async ({ chatId, messageId }) => {
      if (!chatId || !messageId || !(await isChatMember(chatId, userId))) return;
      try {
        const r = await Message.updateOne(
          { _id: messageId, chat: chatId, sender: { $ne: userId }, deliveredTo: { $ne: userId } },
          { $addToSet: { deliveredTo: userId } }
        );
        if (r.modifiedCount) emitToChat(chatId, 'message:status', { chatId, messageId, userId, status: 'delivered' });
      } catch {
        /* ignore */
      }
    });

    // read: the recipient opened/looked at the chat → ✓✓ (coloured). Marks all
    // of the other side's messages in this chat as read in one shot.
    socket.on('message:read', async ({ chatId }) => {
      if (!chatId || !(await isChatMember(chatId, userId))) return;
      try {
        const r = await Message.updateMany(
          { chat: chatId, sender: { $ne: userId }, 'readBy.user': { $ne: userId } },
          { $push: { readBy: { user: userId, at: new Date() } } }
        );
        if (r.modifiedCount) emitToChat(chatId, 'message:read', { chatId, userId });
      } catch {
        /* ignore */
      }
    });

    // ── WebRTC signaling (audio / video calls) ────────────────────
    // Direct relay to the callee's personal room; SDP/ICE are opaque here.
    // Every signal is emitted under BOTH naming schemes (`call:*` and the
    // dash-form `incoming-call`/`webrtc-*` aliases) and accepted under both,
    // so either convention works. The Call record is updated server-side on
    // each transition — call history stays correct even if a client dies
    // mid-call. SECURITY: the two call-initiating signals (ring + media offer)
    // are gated on a mutual-contact relationship so a stranger can't ring or
    // force a media negotiation with an arbitrary user. Answer/ICE/end only
    // make sense inside an already-initiated call, so they don't need a gate.
    const relay = (to, names, payload) => names.forEach((n) => emitToUser(to, n, payload));
    const onAll = (names, handler) => names.forEach((n) => socket.on(n, handler));
    // History updates are best-effort here — a DB hiccup must never kill signaling.
    const logCall = (callId, action, opts) => transitionCall(callId, userId, action, opts).catch(() => null);

    // Explicit registration ack (presence itself is keyed off the JWT handshake).
    socket.on('register-user', (cb) => {
      if (typeof cb === 'function') cb({ ok: true, userId });
    });

    onAll(['call:invite', 'call-user'], async (data = {}) => {
      const { to, callId, type, callType, caller } = data;
      if (!to || !(await areMutualContacts(userId, to))) return;
      if (!isOnline(to)) {
        // Race fallback — REST /api/calls/start already reports offline receivers.
        socket.emit('call:unavailable', { callId, to });
        await logCall(callId, 'missed');
        return;
      }
      relay(to, ['call:incoming', 'incoming-call'], {
        from: userId,
        callId,
        type: type || callType || 'audio',
        caller,
      });
    });

    onAll(['call:accept', 'accept-call'], async ({ to, callId } = {}) => {
      await logCall(callId, 'accept');
      relay(to, ['call:accepted', 'accept-call'], { from: userId, callId });
      // Close the ringing popup on the callee's OTHER tabs/devices.
      socket.to(`user:${userId}`).emit('call:handled', { callId });
    });

    onAll(['call:reject', 'reject-call'], async ({ to, callId } = {}) => {
      await logCall(callId, 'reject');
      relay(to, ['call:rejected', 'reject-call'], { from: userId, callId });
      socket.to(`user:${userId}`).emit('call:handled', { callId });
    });

    onAll(['call:offer', 'webrtc-offer'], async ({ to, offer, callId } = {}) => {
      if (to && (await areMutualContacts(userId, to))) {
        relay(to, ['call:offer', 'webrtc-offer'], { from: userId, offer, callId });
      }
    });

    onAll(['call:answer', 'webrtc-answer'], ({ to, answer, callId } = {}) =>
      relay(to, ['call:answer', 'webrtc-answer'], { from: userId, answer, callId })
    );

    onAll(['call:ice-candidate', 'webrtc-ice-candidate'], ({ to, candidate, callId } = {}) =>
      relay(to, ['call:ice-candidate', 'webrtc-ice-candidate'], { from: userId, candidate, callId })
    );

    // Caller gave up before an answer (timeout or manual cancel) → missed call.
    onAll(['call:cancel', 'call-missed'], async ({ to, callId } = {}) => {
      await logCall(callId, 'missed');
      relay(to, ['call:cancelled', 'call-missed'], { from: userId, callId });
    });

    onAll(['call:end', 'end-call'], async ({ to, callId, duration } = {}) => {
      await logCall(callId, 'end', { duration });
      relay(to, ['call:ended', 'call-ended'], { from: userId, callId });
    });

    // ── Disconnect / presence ─────────────────────────────────────
    socket.on('disconnect', async () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          await setPresence(userId, false);
          socket.broadcast.emit('user-offline', { userId, lastSeen: new Date() });
        }
      }
    });

    // ── Presence (AFTER all listeners are attached) ───────────────
    const wasOffline = !onlineUsers.has(userId);
    if (wasOffline) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.emit('presence-snapshot', { online: onlineUserIds() });
    if (wasOffline) {
      setPresence(userId, true).catch(() => {});
      socket.broadcast.emit('user-online', { userId });
    }
  });

  return io;
}

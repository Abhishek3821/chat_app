import mongoose from 'mongoose';
import { verifyToken } from '../utils/token.js';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Meeting from '../models/Meeting.js';
import Session from '../models/Session.js';
import { isSessionValid } from '../utils/session.js';
import { transitionCall, registerCallInvitee, inSameCall } from '../utils/callService.js';

// Socket payloads DON'T pass through the Express mongoSanitize middleware, so any
// id used in a Mongo query MUST be validated here — otherwise a client could send
// `{ chatId: { $ne: null } }` and turn a scoped update into a whole-collection one.
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

let ioRef = null;
let usingAdapter = false; // true once the Redis adapter is attached (multi-instance)
/** userId -> Set<socketId> (THIS instance only) */
const onlineUsers = new Map();

export function getIO() {
  return ioRef;
}

/** Fast, LOCAL presence check (this instance only). */
export function isOnline(userId) {
  return onlineUsers.has(String(userId));
}

/**
 * Cross-instance presence: local first (cheap), then — when the Redis adapter is
 * attached — ask every instance via the user's personal room. This is what makes
 * "is the callee reachable?" correct across a load-balanced fleet.
 */
export async function isUserOnline(userId) {
  if (!userId) return false;
  if (onlineUsers.has(String(userId))) return true;
  if (usingAdapter && ioRef) {
    try {
      const sockets = await ioRef.in(`user:${String(userId)}`).fetchSockets();
      return sockets.length > 0;
    } catch {
      return false;
    }
  }
  return false;
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

/**
 * May `fromId` send a call signal to `toId`? Allowed when they're mutual contacts
 * (1:1 calls) OR both are members of the same group chat (so group-call
 * participants who aren't personal contacts can still connect to each other).
 */
async function canSignal(fromId, toId, chatId) {
  if (!isId(fromId) || !isId(toId)) return false;
  if (await areMutualContacts(fromId, toId)) return true;
  if (isId(chatId)) {
    try {
      const chat = await Chat.findOne({
        _id: chatId,
        isGroup: true,
        'participants.user': { $all: [String(fromId), String(toId)] },
      }).select('_id');
      if (chat) return true;
    } catch {
      /* bad ObjectId */
    }
  }
  return false;
}

/** True if the user is a participant of the chat. */
async function isChatMember(chatId, userId) {
  if (!isId(chatId) || !isId(userId)) return false;
  try {
    const chat = await Chat.findOne({ _id: chatId, 'participants.user': userId }).select('_id');
    return !!chat;
  } catch {
    return false; // bad ObjectId etc.
  }
}

export function initSocket(io, { hasAdapter = false } = {}) {
  ioRef = io;
  usingAdapter = hasAdapter;

  // Authenticate every socket connection with the JWT and re-check account state,
  // so banned/suspended users and revoked tokens can't hold a live socket open.
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('No auth token'));
      const decoded = verifyToken(token);
      // Scoped tokens (media token — lives in URLs) can't open a socket session.
      if (decoded.scope) return next(new Error('Invalid auth token'));
      const user = await User.findById(decoded.id).select('accountStatus tokenVersion privacy name avatar email');
      if (!user) return next(new Error('User no longer exists'));
      if (user.accountStatus !== 'active') return next(new Error('Account is not active'));
      if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        return next(new Error('Session revoked'));
      }
      // Validate the tracked session too — a revoked session can't open a socket.
      if (!decoded.sid) return next(new Error('Invalid session'));
      const session = await Session.findById(decoded.sid).select('user revokedAt expiresAt lastActiveAt');
      if (!isSessionValid(session) || String(session.user) !== String(user._id)) {
        return next(new Error('Session revoked'));
      }
      socket.userId = String(user._id);
      socket.userName = user.name;
      socket.userAvatar = user.avatar;
      socket.userEmail = user.email;
      // Reciprocal read receipts: if this user turned them OFF, we still record
      // their reads server-side (for their own unread counts) but never tell the
      // sender — so they don't reveal read state either.
      socket.readReceipts = user.privacy?.readReceipts !== false;
      next();
    } catch {
      next(new Error('Invalid auth token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.userId);
    // Stashed on socket.data so it survives adapter.fetchSockets() across instances
    // (used to build the meeting-room roster).
    socket.data.userId = userId;
    socket.data.name = socket.userName;
    socket.data.avatar = socket.userAvatar;
    socket.data.email = socket.userEmail;
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

    // A socket is only ever IN `chat:<id>` after join-chat verified membership,
    // so room membership doubles as a free authorization check for relays —
    // a non-member can't inject typing/reaction/read events into a chat.
    const inChat = (chatId) => chatId && socket.rooms.has(`chat:${chatId}`);

    // ── Typing indicators ─────────────────────────────────────────
    socket.on('typing-start', ({ chatId } = {}) => {
      if (inChat(chatId)) socket.to(`chat:${chatId}`).emit('typing-start', { chatId, userId });
    });
    socket.on('typing-stop', ({ chatId } = {}) => {
      if (inChat(chatId)) socket.to(`chat:${chatId}`).emit('typing-stop', { chatId, userId });
    });

    // ── Read receipts ─────────────────────────────────────────────
    socket.on('message-read', ({ chatId, messageIds } = {}) => {
      if (inChat(chatId)) socket.to(`chat:${chatId}`).emit('message-read', { chatId, messageIds, userId });
    });

    // ── Live reactions (also persisted via REST) ──────────────────
    socket.on('message-reaction', (payload) => {
      if (inChat(payload?.chatId)) socket.to(`chat:${payload.chatId}`).emit('message-reaction', payload);
    });

    // ── Delivery / read receipts (persist + broadcast — drives the ticks) ──
    // delivered: the recipient's device received a specific message → ✓✓ (grey)
    socket.on('message:delivered', async ({ chatId, messageId }) => {
      if (!isId(messageId) || !(await isChatMember(chatId, userId))) return;
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
        // Only surface the read to the sender if this reader allows read receipts.
        if (r.modifiedCount && socket.readReceipts) emitToChat(chatId, 'message:read', { chatId, userId });
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

    // Post-invite signaling gate: mutual contacts / same-group members may
    // always signal — otherwise both parties must belong to the SAME live call
    // (ad-hoc conference legs between members who aren't personal contacts;
    // membership only ever grows via a contact-gated call:invite below).
    const canCallSignal = async (to, chatId, callId) =>
      (await canSignal(userId, to, chatId)) || (await inSameCall(callId, userId, to).catch(() => false));
    // Live call legs this socket is signaling with (peerId -> callId). Lets the
    // disconnect handler end the call for the OTHER side when this browser dies
    // abruptly (crash/network loss) instead of leaving them hanging and the Call
    // record stuck in ringing/accepted forever.
    const callPeers = new Map();
    const trackPeer = (to, callId) => to && callPeers.set(String(to), callId);
    const untrackPeer = (to) => to && callPeers.delete(String(to));

    // Explicit registration ack (presence itself is keyed off the JWT handshake).
    socket.on('register-user', (cb) => {
      if (typeof cb === 'function') cb({ ok: true, userId });
    });

    onAll(['call:invite', 'call-user'], async (data = {}) => {
      const { to, callId, type, callType, caller, chatId } = data;
      if (!to || !(await canSignal(userId, to, chatId))) return;
      if (!(await isUserOnline(to))) {
        // Race fallback — REST /api/calls/start already reports offline receivers.
        socket.emit('call:unavailable', { callId, to });
        await logCall(callId, 'missed');
        return;
      }
      trackPeer(to, callId);
      // Persist the invitee on the Call record — this is what authorizes their
      // signaling legs to EVERY conference member later (not just to the adder).
      await registerCallInvitee(callId, userId, to).catch(() => null);
      relay(to, ['call:incoming', 'incoming-call'], {
        from: userId,
        callId,
        type: type || callType || 'audio',
        caller,
        chatId, // present → the callee treats this as a group call
        isGroup: !!chatId,
      });
    });

    // Conference introduction: a member who ADDED someone tells the existing
    // members about the newcomer (and vice versa) so every pair mesh-connects.
    // Both sides must already belong to this call record — nobody can be pulled
    // into a call they weren't invited to via a contact-gated call:invite.
    onAll(['call:introduce'], async ({ to, callId, peer } = {}) => {
      if (!to || !callId || !peer?._id) return;
      if (!(await inSameCall(callId, userId, to).catch(() => false))) return;
      relay(to, ['call:introduced'], {
        from: userId,
        callId,
        peer: { _id: String(peer._id), name: peer.name, avatar: peer.avatar },
      });
    });

    // For group calls `call:accept` doubles as the mesh "I'm here" hello, so it's
    // gated by canSignal (group membership) like the media signals.
    onAll(['call:accept', 'accept-call'], async ({ to, callId, chatId } = {}) => {
      if (to && !(await canCallSignal(to, chatId, callId))) return;
      await logCall(callId, 'accept');
      trackPeer(to, callId);
      relay(to, ['call:accepted', 'accept-call'], { from: userId, callId, chatId });
      // Close the ringing popup on the callee's OTHER tabs/devices.
      socket.to(`user:${userId}`).emit('call:handled', { callId });
    });

    onAll(['call:reject', 'reject-call'], async ({ to, callId, chatId } = {}) => {
      await logCall(callId, 'reject');
      untrackPeer(to);
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:rejected', 'reject-call'], { from: userId, callId });
      }
      socket.to(`user:${userId}`).emit('call:handled', { callId });
    });

    // Callee is already on another call / in a meeting → tell the caller they're
    // busy (shown as "busy on another call") and log it as missed for history.
    onAll(['call:busy'], async ({ to, callId, chatId } = {}) => {
      await logCall(callId, 'missed');
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:busy'], { from: userId, callId });
      }
    });

    // Screen-share presence: lets the other side render a presented screen with
    // the right fit (contain, spotlight) instead of cropping it like a camera.
    onAll(['call:screen'], async ({ to, callId, chatId, on } = {}) => {
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:screen'], { from: userId, callId, on: !!on });
      }
    });

    onAll(['call:offer', 'webrtc-offer'], async ({ to, offer, callId, chatId } = {}) => {
      if (to && (await canCallSignal(to, chatId, callId))) {
        trackPeer(to, callId); // covers group-mesh legs that never sent call:invite
        relay(to, ['call:offer', 'webrtc-offer'], { from: userId, offer, callId, chatId });
      }
    });

    onAll(['call:answer', 'webrtc-answer'], async ({ to, answer, callId, chatId } = {}) => {
      if (to && (await canCallSignal(to, chatId, callId))) {
        trackPeer(to, callId);
        relay(to, ['call:answer', 'webrtc-answer'], { from: userId, answer, callId, chatId });
      }
    });

    onAll(['call:ice-candidate', 'webrtc-ice-candidate'], async ({ to, candidate, callId, chatId } = {}) => {
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:ice-candidate', 'webrtc-ice-candidate'], { from: userId, candidate, callId, chatId });
      }
    });

    // Caller gave up before an answer (timeout or manual cancel) → missed call.
    onAll(['call:cancel', 'call-missed'], async ({ to, callId, chatId } = {}) => {
      await logCall(callId, 'missed');
      untrackPeer(to);
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:cancelled', 'call-missed'], { from: userId, callId });
      }
    });

    onAll(['call:end', 'end-call'], async ({ to, callId, duration, chatId } = {}) => {
      await logCall(callId, 'end', { duration });
      untrackPeer(to);
      if (to && (await canCallSignal(to, chatId, callId))) {
        relay(to, ['call:ended', 'call-ended'], { from: userId, callId });
      }
    });

    // ── Meeting rooms (Google-Meet-style shareable links) ─────────
    // A meeting room is a full-mesh WebRTC space keyed by socket id (a user may
    // even join from two tabs). Anyone signed in who holds a valid, non-cancelled
    // room code may join — that's the whole point of a shareable link. Signaling
    // is relayed only between sockets that are actually in the SAME room.
    const meetingRoom = (meetingId) => `mtg:${meetingId}`;

    async function meetingPeers(meetingId, exceptId) {
      try {
        const sockets = await ioRef.in(meetingRoom(meetingId)).fetchSockets();
        return sockets
          .filter((s) => s.id !== exceptId)
          .map((s) => ({ socketId: s.id, userId: s.data.userId, name: s.data.name, avatar: s.data.avatar }));
      } catch {
        return [];
      }
    }

    // Join a room → get the list of peers already inside, and announce yourself
    // to them. The NEWCOMER initiates the offer to each existing peer (no glare).
    socket.on('meeting:join', async ({ meetingId } = {}, cb) => {
      if (!isId(meetingId)) return typeof cb === 'function' && cb({ ok: false, error: 'Invalid meeting.' });
      let meeting;
      try {
        meeting = await Meeting.findById(meetingId).select('status host settings');
      } catch {
        meeting = null;
      }
      if (!meeting || meeting.status === 'cancelled') {
        return typeof cb === 'function' && cb({ ok: false, error: 'Meeting not available.' });
      }
      const isHost = String(meeting.host) === userId;
      const peers = await meetingPeers(meetingId, socket.id);
      // Host-controlled "join anytime": if off, a guest can't enter until the
      // host is actually in the room.
      if (meeting.settings?.joinAnytime === false && !isHost) {
        const hostPresent = peers.some((p) => String(p.userId) === String(meeting.host));
        if (!hostPresent) {
          return typeof cb === 'function' && cb({ ok: false, waiting: true, error: 'The host hasn’t started this meeting yet.' });
        }
      }
      socket.join(meetingRoom(meetingId));
      if (!socket.data.meetings) socket.data.meetings = new Set();
      socket.data.meetings.add(String(meetingId));
      // Remember whether THIS socket is the meeting host, so host-only in-meeting
      // controls (mute-all, force-mute, remove) can be authorized without a DB hit.
      if (!socket.data.meetingHost) socket.data.meetingHost = {};
      socket.data.meetingHost[String(meetingId)] = isHost;
      if (!socket.data.meetingJoinAt) socket.data.meetingJoinAt = {};
      socket.data.meetingJoinAt[String(meetingId)] = Date.now();
      // Attendance record (best-effort): stamp the meeting's start on the first
      // join, and add this person's row once (name/email snapshot).
      const nowJoin = new Date();
      Meeting.updateOne({ _id: meetingId, startedAt: null }, { $set: { startedAt: nowJoin, status: 'ongoing' } }).catch(() => {});
      Meeting.updateOne(
        { _id: meetingId, 'attendees.user': { $ne: userId } },
        { $push: { attendees: { user: userId, name: socket.data.name, email: socket.data.email, joinedAt: nowJoin, durationSeconds: 0 } } }
      ).catch(() => {});
      socket.to(meetingRoom(meetingId)).emit('meeting:peer-joined', {
        socketId: socket.id,
        userId,
        name: socket.data.name,
        avatar: socket.data.avatar,
      });
      if (typeof cb === 'function') cb({ ok: true, peers, isHost });
    });

    // Relay an opaque SDP/ICE payload to ONE specific socket, only if the sender
    // is actually in that room (prevents cross-room signal injection).
    socket.on('meeting:signal', ({ meetingId, to, data } = {}) => {
      if (!to || !meetingId || !socket.rooms.has(meetingRoom(meetingId))) return;
      ioRef.to(to).emit('meeting:signal', { from: socket.id, data });
    });

    // Screen-share announcements: everyone in the room learns who is presenting
    // so they can spotlight that stream (Google-Meet style) instead of cropping it.
    socket.on('meeting:presenting', ({ meetingId, on } = {}) => {
      if (!meetingId || !socket.rooms.has(meetingRoom(meetingId))) return;
      socket.to(meetingRoom(meetingId)).emit('meeting:presenting', { socketId: socket.id, on: !!on });
    });

    // In-room presence of the sender (used by all the interaction relays below).
    const inRoom = (meetingId) => Boolean(meetingId && socket.rooms.has(meetingRoom(meetingId)));
    const isRoomHost = (meetingId) => Boolean(socket.data.meetingHost?.[String(meetingId)]);

    // In-meeting text chat — broadcast to the whole room (incl. the sender's other
    // tabs is unnecessary; use socket.to so the sender renders its own optimistically).
    socket.on('meeting:chat', ({ meetingId, text } = {}) => {
      const body = String(text || '').trim().slice(0, 2000);
      if (!inRoom(meetingId) || !body) return;
      socket.to(meetingRoom(meetingId)).emit('meeting:chat', {
        socketId: socket.id, userId, name: socket.data.name, avatar: socket.data.avatar, text: body, at: Date.now(),
      });
    });

    // Emoji reaction burst (👍 ❤️ 😂 🎉 👏 …) shown floating over the sender's tile.
    // userId is included so the SFU (LiveKit) path — whose tiles are keyed by user,
    // not socket — can line the reaction up with the right tile too.
    socket.on('meeting:reaction', ({ meetingId, emoji } = {}) => {
      const e = String(emoji || '').slice(0, 8);
      if (!inRoom(meetingId) || !e) return;
      socket.to(meetingRoom(meetingId)).emit('meeting:reaction', { socketId: socket.id, userId, name: socket.data.name, emoji: e });
    });

    // Raise / lower hand.
    socket.on('meeting:hand', ({ meetingId, up } = {}) => {
      if (!inRoom(meetingId)) return;
      socket.to(meetingRoom(meetingId)).emit('meeting:hand', { socketId: socket.id, userId, name: socket.data.name, up: !!up });
    });

    // ── Host moderation (host socket only) ──
    // Ask everyone (or one person) to mute; the client disables its own mic. This
    // is a request the browser CANNOT force — but it always mutes a compliant client.
    socket.on('meeting:mute-all', ({ meetingId } = {}) => {
      if (!inRoom(meetingId) || !isRoomHost(meetingId)) return;
      socket.to(meetingRoom(meetingId)).emit('meeting:force-mute', { by: socket.data.name, all: true });
    });
    // `to` is a socketId (mesh) OR `toUser` is a userId (SFU path, tiles keyed by
    // user). Either way the target client just mutes itself.
    socket.on('meeting:force-mute', ({ meetingId, to, toUser } = {}) => {
      if (!inRoom(meetingId) || !isRoomHost(meetingId)) return;
      if (toUser) ioRef.to(`user:${toUser}`).emit('meeting:force-mute', { by: socket.data.name });
      else if (to) ioRef.to(to).emit('meeting:force-mute', { by: socket.data.name });
    });
    // Remove a participant: tell them they were removed (their client leaves) and
    // make them leave the socket room so no further media/signal reaches them.
    socket.on('meeting:remove', async ({ meetingId, to, toUser } = {}) => {
      if (!inRoom(meetingId) || !isRoomHost(meetingId)) return;
      try {
        const roomSockets = await ioRef.in(meetingRoom(meetingId)).fetchSockets();
        // Target by socketId (mesh) or by userId (SFU) — a user may hold several.
        const targets = roomSockets.filter((s) => (toUser ? String(s.data.userId) === String(toUser) : s.id === to) && s.id !== socket.id);
        for (const target of targets) {
          ioRef.to(target.id).emit('meeting:removed', { by: socket.data.name });
          target.leave(meetingRoom(meetingId));
          socket.to(meetingRoom(meetingId)).emit('meeting:peer-left', { socketId: target.id });
        }
      } catch {
        /* best-effort */
      }
    });

    // Finalize this socket's attendance for a meeting: add the session's duration,
    // stamp leftAt/endedAt, and mark the meeting completed once the room empties.
    async function finalizeAttendance(meetingId) {
      const startedMs = socket.data.meetingJoinAt?.[String(meetingId)];
      if (socket.data.meetingJoinAt) delete socket.data.meetingJoinAt[String(meetingId)];
      const now = new Date();
      const session = startedMs ? Math.max(0, Math.round((Date.now() - startedMs) / 1000)) : 0;
      try {
        await Meeting.updateOne(
          { _id: meetingId, 'attendees.user': userId },
          { $inc: { 'attendees.$.durationSeconds': session }, $set: { 'attendees.$.leftAt': now, endedAt: now } }
        );
        const remaining = (await ioRef.in(meetingRoom(meetingId)).fetchSockets()).filter((s) => s.id !== socket.id);
        if (remaining.length === 0) {
          await Meeting.updateOne({ _id: meetingId, status: 'ongoing' }, { $set: { status: 'completed' } });
        }
      } catch {
        /* attendance is best-effort — never break the socket */
      }
    }

    const leaveMeeting = (meetingId) => {
      if (!meetingId || !isId(meetingId)) return;
      socket.leave(meetingRoom(meetingId));
      socket.data.meetings?.delete(String(meetingId));
      if (socket.data.meetingHost) delete socket.data.meetingHost[String(meetingId)];
      socket.to(meetingRoom(meetingId)).emit('meeting:peer-left', { socketId: socket.id });
      finalizeAttendance(meetingId);
    };
    socket.on('meeting:leave', ({ meetingId } = {}) => leaveMeeting(meetingId));

    // ── Disconnect / presence ─────────────────────────────────────
    socket.on('disconnect', async () => {
      // End any live call legs this socket was signaling: notify each peer (so
      // their UI doesn't hang on a dead connection) and close the Call record.
      // transitionCall maps end-while-ringing to 'missed', so a caller dying
      // before an answer is recorded correctly too.
      for (const [peerId, callId] of callPeers) {
        const call = await transitionCall(callId, userId, 'end').catch(() => null);
        const names = call && call.status === 'missed'
          ? ['call:cancelled', 'call-missed'] // never answered → close the ringing popup
          : ['call:ended', 'call-ended'];
        relay(peerId, names, { from: userId, callId, reason: 'peer-disconnected' });
      }
      callPeers.clear();
      // Tell every meeting room this socket was in that the peer is gone, and
      // finalize its attendance record.
      if (socket.data.meetings) {
        for (const mId of socket.data.meetings) {
          socket.to(meetingRoom(mId)).emit('meeting:peer-left', { socketId: socket.id });
          await finalizeAttendance(mId);
        }
      }
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          // In a multi-instance deploy the user may still be connected to another
          // node — only mark them offline once they're gone everywhere.
          if (!(await isUserOnline(userId))) {
            await setPresence(userId, false);
            socket.broadcast.emit('user-offline', { userId, lastSeen: new Date() });
          }
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

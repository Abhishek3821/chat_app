import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { ApiError } from './asyncHandler.js';
import { groupCan, PERMISSIONS } from './rbac.js';
import { emitToChat } from '../socket/index.js';

/**
 * Pinned messages: durations, who may pin, and expiry.
 *
 * A pin is chat-wide (everyone sees it) and temporary — the pinner picks how
 * long it stays up. That's the difference from starring, which is private and
 * permanent.
 */

/** The only durations a client may ask for, in hours. */
export const PIN_DURATIONS = [1, 6, 12, 24];

/**
 * How many pins one chat can hold at once. WhatsApp's limit is 3, and the cap
 * matters beyond parity: the pinned set is populated and shipped with every
 * message fetch, so it has to stay small. Pinning past the cap evicts the
 * oldest pin rather than erroring — being told "unpin something first" when you
 * can't see what's pinned is a dead end.
 */
export const MAX_PINS_PER_CHAT = 3;

export function assertValidDuration(hours) {
  const h = Number(hours);
  if (!PIN_DURATIONS.includes(h)) {
    throw new ApiError(400, `Pin duration must be one of ${PIN_DURATIONS.join(', ')} hours.`);
  }
  return h;
}

/**
 * Who may pin in this chat.
 *
 * Groups: admins and owners only — a pin is a broadcast to everyone in the
 * room, so it's a moderation action, and the RBAC matrix already models exactly
 * that as GROUP_MANAGE. Direct chats: either person, since there is no
 * asymmetry of authority between two people.
 */
export function canPin(chat, userId) {
  const me = chat.participants.find((p) => String(p.user?._id || p.user) === String(userId));
  if (!me) return false;
  if (!chat.isGroup) return true;
  return groupCan(me.role, PERMISSIONS.GROUP_MANAGE);
}

export function assertMayPin(chat, userId) {
  if (!canPin(chat, userId)) {
    throw new ApiError(403, chat.isGroup ? 'Only group admins can pin messages.' : 'You are not a participant of this chat.');
  }
}

/**
 * Who may REMOVE a given pin. Deliberately looser than pinning: whoever put it
 * up can always take it down (including a member who pinned in a direct chat),
 * and group admins can clear anyone's.
 */
export function canUnpin(chat, pin, userId) {
  if (String(pin.pinnedBy) === String(userId)) return true;
  return canPin(chat, userId);
}

/** The pins that are still live right now, newest first. */
export function activePins(chat, now = Date.now()) {
  return (chat.pins || [])
    .filter((p) => p?.expiresAt && new Date(p.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt));
}

/** Shape a pin for the wire (ids as strings, no mongoose internals). */
export function serializePin(pin) {
  return {
    messageId: String(pin.message?._id || pin.message),
    pinnedBy: pin.pinnedBy ? String(pin.pinnedBy._id || pin.pinnedBy) : null,
    pinnedAt: pin.pinnedAt,
    expiresAt: pin.expiresAt,
    durationHours: pin.durationHours,
  };
}

/**
 * Active pins with their messages loaded, for a chat the caller is in.
 * `deletedFor` is honoured: a message you deleted for yourself must not come
 * back into view just because someone pinned it.
 */
export async function populatedPins(chat, userId) {
  const live = activePins(chat);
  if (!live.length) return [];
  const ids = live.map((p) => p.message);
  const messages = await Message.find({ _id: { $in: ids }, deletedFor: { $ne: userId } })
    .populate('sender', 'name username avatar')
    .lean();
  const byId = new Map(messages.map((m) => [String(m._id), m]));

  return live
    .map((p) => {
      const message = byId.get(String(p.message));
      return message ? { ...serializePin(p), message } : null;
    })
    .filter(Boolean);
}

/**
 * Remove lapsed pins from the database and tell anyone watching.
 *
 * Reads already filter by `expiresAt`, so this is not what makes expiry
 * correct — it's what keeps the arrays from growing forever and what makes an
 * open client's banner disappear on time instead of at its next refresh.
 *
 * One query finds the affected chats, then each is updated with a `$pull` on
 * the expiry bound, so a pin added between the read and the write is untouched.
 */
export async function sweepExpiredPins() {
  const now = new Date();
  const chats = await Chat.find({ 'pins.expiresAt': { $lte: now } })
    .select('_id pins')
    .limit(500) // bounded per tick; the next one picks up any remainder
    .lean();

  for (const chat of chats) {
    const expired = (chat.pins || []).filter((p) => p.expiresAt && new Date(p.expiresAt) <= now);
    if (!expired.length) continue;
    await Chat.updateOne({ _id: chat._id }, { $pull: { pins: { expiresAt: { $lte: now } } } });
    for (const pin of expired) {
      emitToChat(String(chat._id), 'message-pinned', {
        chatId: String(chat._id),
        messageId: String(pin.message),
        pinned: false,
        reason: 'expired',
      });
    }
  }
  return chats.length;
}

/** Start the sweeper. Idempotent; safe to call from every instance. */
let timer = null;
export function startPinSweeper(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    sweepExpiredPins().catch(() => null);
  }, intervalMs);
  timer.unref?.(); // never hold the process open on shutdown
}

export function stopPinSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

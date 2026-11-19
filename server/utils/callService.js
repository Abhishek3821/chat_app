import mongoose from 'mongoose';
import Call from '../models/Call.js';

const TERMINAL = new Set(['completed', 'missed', 'rejected']);

/** True if the user started the call or was rung by it. */
function isInvolved(call, userId) {
  const uid = String(userId);
  return (
    String(call.initiator) === uid ||
    String(call.caller || '') === uid ||
    String(call.receiver || '') === uid ||
    call.participants.some((p) => String(p.user) === uid)
  );
}

/**
 * Single place where a call record changes state, shared by the REST API and
 * the Socket.IO signaling handlers so history stays consistent no matter which
 * channel reports first. Terminal states never regress (idempotent by design —
 * both peers report end/missed events).
 *
 * actions: 'accept' | 'reject' | 'missed' | 'end'
 * Returns the updated call, or null when callId is unknown/foreign/not an ObjectId.
 */
export async function transitionCall(callId, userId, action, { duration } = {}, attempt = 0) {
  if (!mongoose.isValidObjectId(callId)) return null;
  const call = await Call.findById(callId);
  if (!call || !isInvolved(call, userId)) return null;
  if (TERMINAL.has(call.status)) return call;

  const from = call.status;
  const now = new Date();
  const set = {};
  let participant = null; // { user, patch } — this user's row on the participants list
  switch (action) {
    case 'accept':
      if (from !== 'ringing') return call;
      set.status = 'accepted';
      set.answeredAt = now;
      participant = { user: userId, patch: { status: 'joined', joinedAt: now } };
      break;
    case 'reject':
      set.status = 'rejected';
      set.endedAt = now;
      participant = { user: userId, patch: { status: 'rejected' } };
      break;
    case 'missed':
      // Only a never-answered call can be missed.
      if (from === 'ringing') {
        set.status = 'missed';
        set.endedAt = call.endedAt || now;
        if (call.receiver) participant = { user: call.receiver, patch: { status: 'missed' } };
      } else if (!call.endedAt) {
        set.endedAt = now;
      } else {
        return call;
      }
      break;
    case 'end': {
      const wasLive = from === 'accepted' || from === 'ongoing';
      set.status = wasLive ? 'completed' : 'missed'; // hang-up while still ringing = cancelled → missed
      set.endedAt = now;
      if (wasLive) {
        const computed = call.answeredAt ? Math.max(0, Math.round((now - call.answeredAt) / 1000)) : 0;
        set.duration = Number.isFinite(Number(duration)) && Number(duration) >= 0 ? Math.round(Number(duration)) : computed;
        participant = { user: userId, patch: { status: 'left', leftAt: now } };
      }
      break;
    }
    default:
      return call;
  }

  /* Compare-and-set on the status we decided from. Read-modify-save let an
     `accept` and the caller's `end` both act on the same "ringing" read — the
     loser's save then wrote "missed" over a call that had actually connected
     (answeredAt set). If the status moved underneath us, re-decide from the
     fresh state (bounded). The participant row is patched positionally so a
     concurrent "add person" isn't overwritten by a stale array. */
  const update = { $set: { ...set } };
  const options = {};
  if (participant) {
    for (const [k, v] of Object.entries(participant.patch)) update.$set[`participants.$[me].${k}`] = v;
    options.arrayFilters = [{ 'me.user': new mongoose.Types.ObjectId(String(participant.user)) }];
  }
  const r = await Call.updateOne({ _id: call._id, status: from }, update, options);
  if (!r.matchedCount) {
    return attempt < 3 ? transitionCall(callId, userId, action, { duration }, attempt + 1) : Call.findById(callId);
  }
  return Call.findById(callId);
}

/**
 * Record that `byUserId` (who must already be involved in the call) rang
 * `invitedUserId` into it — the "add person" flow of an ad-hoc conference.
 * Being on the participants list is what later authorizes the invitee's
 * signaling legs to EVERY other member (see inSameCall), not just the adder.
 */
export async function registerCallInvitee(callId, byUserId, invitedUserId) {
  if (!mongoose.isValidObjectId(callId) || !mongoose.isValidObjectId(String(invitedUserId))) return null;
  const call = await Call.findById(callId);
  // No status guard: a member may add people even after another member hung up
  // (which marks the record 'completed' while the conference is still live).
  if (!call || !isInvolved(call, byUserId)) return null;
  if (!isInvolved(call, invitedUserId)) {
    call.participants.push({ user: invitedUserId, status: 'ringing' });
    await call.save();
  }
  return call;
}

/**
 * True when BOTH users belong to the same call record. Lets conference members
 * who aren't mutual contacts signal each other (their membership was vouched
 * for by whoever invited them — see registerCallInvitee). Deliberately ignores
 * the call status: one member hanging up marks the record 'completed' while the
 * conference legitimately continues for everyone else, and their ICE restarts /
 * screen toggles / hang-ups must keep relaying.
 */
export async function inSameCall(callId, aId, bId) {
  if (!mongoose.isValidObjectId(callId)) return false;
  const call = await Call.findById(callId).select('initiator caller receiver participants');
  return !!call && isInvolved(call, aId) && isInvolved(call, bId);
}

/**
 * Close out zombie call records: rings that nobody ever answered or cancelled
 * (both browsers died before reporting), and "live" calls whose last update is
 * ancient. Keeps call history truthful even when no client survived to report
 * the ending. Called on an interval from server.js.
 */
export async function sweepStaleCalls({ ringingAfterMs = 90e3, liveAfterMs = 12 * 3600e3 } = {}) {
  const now = Date.now();
  await Call.updateMany(
    { status: 'ringing', createdAt: { $lt: new Date(now - ringingAfterMs) } },
    { $set: { status: 'missed', endedAt: new Date() } }
  );
  await Call.updateMany(
    { status: { $in: ['accepted', 'ongoing'] }, updatedAt: { $lt: new Date(now - liveAfterMs) } },
    { $set: { status: 'completed', endedAt: new Date() } }
  );
}

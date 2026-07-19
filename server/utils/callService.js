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

function setParticipant(call, userId, patch) {
  const p = call.participants.find((x) => String(x.user) === String(userId));
  if (p) Object.assign(p, patch);
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
export async function transitionCall(callId, userId, action, { duration } = {}) {
  if (!mongoose.isValidObjectId(callId)) return null;
  const call = await Call.findById(callId);
  if (!call || !isInvolved(call, userId)) return null;
  if (TERMINAL.has(call.status)) return call;

  const now = new Date();
  switch (action) {
    case 'accept':
      if (call.status !== 'ringing') break;
      call.status = 'accepted';
      call.answeredAt = now;
      setParticipant(call, userId, { status: 'joined', joinedAt: now });
      break;
    case 'reject':
      call.status = 'rejected';
      call.endedAt = now;
      setParticipant(call, userId, { status: 'rejected' });
      break;
    case 'missed':
      // Only a never-answered call can be missed.
      call.status = call.status === 'ringing' ? 'missed' : call.status;
      call.endedAt = call.endedAt || now;
      if (call.status === 'missed' && call.receiver) setParticipant(call, call.receiver, { status: 'missed' });
      break;
    case 'end': {
      const wasLive = call.status === 'accepted' || call.status === 'ongoing';
      call.status = wasLive ? 'completed' : 'missed'; // hang-up while still ringing = cancelled → missed
      call.endedAt = now;
      if (wasLive) {
        const computed = call.answeredAt ? Math.max(0, Math.round((now - call.answeredAt) / 1000)) : 0;
        call.duration = Number.isFinite(Number(duration)) && Number(duration) >= 0 ? Math.round(Number(duration)) : computed;
        setParticipant(call, userId, { status: 'left', leftAt: now });
      }
      break;
    }
    default:
      return call;
  }
  await call.save();
  return call;
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

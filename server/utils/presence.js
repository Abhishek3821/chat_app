import User from '../models/User.js';

/**
 * Presence that can be trusted.
 *
 * `User.isOnline` was a plain persisted boolean flipped on socket connect and
 * disconnect, which made it wrong in three ordinary situations:
 *
 *   1. THE PROCESS DIES while people are connected — a crash, a deploy, a
 *      dev-server restart. No disconnect handler runs, so every one of those
 *      rows keeps `isOnline: true` FOREVER. Nothing ever reset them, so after a
 *      few restarts the whole user table reads "online" permanently. This is the
 *      main reason everyone appeared online all the time.
 *   2. A TAB LEFT OPEN overnight holds the socket, so someone who walked away
 *      hours ago still shows as online.
 *   3. A HALF-OPEN SOCKET (laptop lid closed, network dropped) can sit for a
 *      long time before the transport notices.
 *
 * The fix is to stop treating the boolean as the truth and derive presence from
 * a heartbeat instead: you are online only if a socket has said so RECENTLY.
 * `lastSeen` carries that timestamp, the client pings while its tab is visible,
 * and anything staler than PRESENCE_TTL_MS is offline — whether or not a socket
 * is technically still attached.
 */

/** No heartbeat for this long ⇒ offline. */
export const PRESENCE_TTL_MS = 5 * 60 * 1000;
/** How often the sweeper looks for people who went quiet. */
const SWEEP_INTERVAL_MS = 60 * 1000;
/** Heartbeats arrive per tab; collapse them so N tabs aren't N writes a minute. */
const TOUCH_THROTTLE_MS = 30 * 1000;

const lastTouch = new Map(); // userId -> ms of the last DB write

/**
 * Clear every stale "online" at boot. A process that has just started has
 * nobody connected to it, so any `isOnline: true` in the database is a leftover
 * from a previous life. Without this, presence never recovers from a crash.
 */
export async function resetAllPresence() {
  try {
    const res = await User.updateMany({ isOnline: true }, { $set: { isOnline: false } });
    return res.modifiedCount || 0;
  } catch {
    return 0;
  }
}

/**
 * Record that a user is alive right now. Throttled per user, because this runs
 * on every heartbeat from every tab and the exact second doesn't matter when the
 * window is five minutes.
 */
export function touchPresence(userId) {
  const id = String(userId || '');
  if (!id) return;
  const now = Date.now();
  if (now - (lastTouch.get(id) || 0) < TOUCH_THROTTLE_MS) return;
  lastTouch.set(id, now);
  User.updateOne({ _id: id }, { $set: { isOnline: true, lastSeen: new Date() } }).catch(() => {});
}

/** Forget a user's throttle slot (on disconnect) so a reconnect writes immediately. */
export function forgetPresence(userId) {
  lastTouch.delete(String(userId || ''));
}

/** Is this user's heartbeat recent enough to call them online? */
export function isPresenceFresh(user) {
  if (!user?.isOnline) return false;
  const seen = user.lastSeen ? new Date(user.lastSeen).getTime() : 0;
  return Number.isFinite(seen) && Date.now() - seen < PRESENCE_TTL_MS;
}

/**
 * Apply that rule to a serialized user before it goes out.
 *
 * The sweeper below only runs once a minute, and a read can land in between —
 * so every read path derives freshness itself rather than trusting the stored
 * flag. Mutates and returns the object.
 */
export function applyPresenceFreshness(obj) {
  if (obj && obj.isOnline && !isPresenceFresh(obj)) obj.isOnline = false;
  return obj;
}

/**
 * Periodically mark everyone who stopped heartbeating as offline, and tell the
 * connected clients so their lists update without a refresh.
 *
 * @param {(userId: string, lastSeen: Date) => void} onOffline
 */
export function startPresenceSweeper(onOffline) {
  const timer = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
      // Pull the ids first: updateMany can't tell us WHO it touched, and the
      // clients need to be told individually.
      const stale = await User.find({ isOnline: true, lastSeen: { $lt: cutoff } })
        .select('_id lastSeen')
        .limit(500)
        .lean();
      if (!stale.length) return;
      await User.updateMany({ _id: { $in: stale.map((u) => u._id) } }, { $set: { isOnline: false } });
      for (const u of stale) {
        lastTouch.delete(String(u._id));
        try {
          onOffline?.(String(u._id), u.lastSeen);
        } catch {
          /* one bad listener must not stop the sweep */
        }
      }
    } catch {
      /* a failed sweep is retried on the next tick */
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.(); // never hold the process open
  return timer;
}

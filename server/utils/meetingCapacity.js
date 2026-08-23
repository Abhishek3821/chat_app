import { livekitEnabled } from './livekit.js';

/**
 * How many people a meeting can actually carry, and the gate that enforces it.
 *
 * Until now nothing enforced anything: the client showed an amber banner past six
 * participants, but a banner is not a control. A 20-person meeting let all twenty
 * in and then became unusable for everyone — including the people who were
 * already talking. The honest behaviour is to refuse the joiner who would break
 * the room and say why, rather than degrade it for the whole group.
 *
 * The limit exists because of mesh arithmetic, not policy: with no server in the
 * media path every participant sends their camera to every other participant
 * separately, so upload and CPU grow with the room. See docs/SCALING_CALLS.md.
 *
 * Two deliberate exemptions:
 *
 *   · WITH AN SFU (LiveKit configured) there is no such ceiling — each device
 *     sends one stream and the server fans it out. The cap must not apply, or
 *     turning on the SFU would leave an invisible limit behind.
 *   · THE HOST is always let in. Being locked out of your own meeting, with no
 *     way to end it or remove anyone, is worse than one extra participant.
 *
 * Mirrors MESH_HARD_LIMIT in client/src/lib/meshQuality.js. The client uses it to
 * warn; this is what actually holds.
 */

const DEFAULT_LIMIT = 9;

/** Operator override, e.g. to be stricter on modest hardware. */
export function meshParticipantLimit() {
  const raw = Number(process.env.MESH_MAX_PARTICIPANTS);
  if (!Number.isFinite(raw) || raw < 2) return DEFAULT_LIMIT;
  // An absurdly high value would be the same as no limit; cap it so a typo
  // cannot quietly disable the gate.
  return Math.min(Math.floor(raw), 50);
}

/**
 * Should this join be refused?
 *
 * @param {number} peersInRoom  Sockets already in the room, excluding the joiner.
 *                              Sockets, not users: a second tab is a second set
 *                              of peer connections and costs the same as another
 *                              person.
 * @param {boolean} isHost      Hosts bypass the cap.
 * @returns {{full: boolean, limit: number, error?: string}}
 */
export function meetingCapacityCheck(peersInRoom, isHost) {
  const limit = meshParticipantLimit();
  if (livekitEnabled() || isHost) return { full: false, limit };
  const wouldBe = Number(peersInRoom) + 1;
  if (wouldBe <= limit) return { full: false, limit };
  return {
    full: true,
    limit,
    error: `This meeting is full (${limit} people). It runs peer-to-peer, so more participants would freeze the video for everyone already in. Ask the host to enable the meeting server for larger rooms.`,
  };
}

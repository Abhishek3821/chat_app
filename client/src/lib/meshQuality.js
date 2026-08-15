/**
 * Encoder tuning and capacity limits for FULL-MESH audio/video.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — the arithmetic of a mesh
 * ════════════════════════════════════════════════════════════════════════
 * In a mesh every participant sends their camera to every other participant
 * SEPARATELY. There is no server in the media path, so the cost lands on the
 * device and its uplink, and it grows with the room:
 *
 *      participants │ streams each device sends │ upload at 720p (~1.5 Mbps)
 *      ─────────────┼───────────────────────────┼──────────────────────────
 *            3      │            2              │        ~3 Mbps
 *            6      │            5              │        ~7.5 Mbps
 *           10      │            9              │       ~13 Mbps
 *           17      │           16              │       ~24 Mbps
 *
 * A typical home connection uploads 5–20 Mbps and a phone on mobile data far
 * less, so past roughly six people the link saturates, frames drop, and the
 * device heats up encoding N simultaneous streams. That is not a bug that can be
 * tuned away — it is what a mesh costs.
 *
 * Two things this module does about it:
 *
 *  1. SCALE THE ENCODER DOWN as the room grows. The video was previously
 *     requested at 720p with NO sender limits at all, so a 6-person call tried to
 *     push six 720p streams. Dropping resolution and bitrate per extra peer keeps
 *     small and medium rooms genuinely smooth.
 *  2. SAY SO when a room outgrows the mesh, instead of letting it silently
 *     degrade into frozen tiles. Beyond that size the honest fix is an SFU
 *     (LiveKit), where each device sends ONE stream and the server fans it out —
 *     already implemented and selected automatically when configured. See
 *     docs/SCALING_CALLS.md.
 */

/** Above this, a mesh is past comfortable and quality is visibly compromised. */
export const MESH_COMFORTABLE_MAX = 6;

/** Above this, a mesh is not a reasonable experience on typical hardware. */
export const MESH_HARD_LIMIT = 9;

/**
 * Sender encoding for a given number of REMOTE peers.
 *
 * Bitrates are per stream, so the totals stay within a normal uplink:
 * five peers at 350 kbps is ~1.75 Mbps up, versus ~7.5 Mbps un-tuned.
 */
export function encodingForPeers(peerCount) {
  if (peerCount <= 1) return { maxBitrate: 1_200_000, scaleResolutionDownBy: 1, label: '720p' };
  if (peerCount <= 3) return { maxBitrate: 700_000, scaleResolutionDownBy: 1.5, label: '480p' };
  if (peerCount <= MESH_COMFORTABLE_MAX) return { maxBitrate: 350_000, scaleResolutionDownBy: 2, label: '360p' };
  return { maxBitrate: 180_000, scaleResolutionDownBy: 3, label: '240p' };
}

/**
 * Apply that encoding to one peer connection's video sender.
 *
 * `setParameters` is the only way to bound what WebRTC sends; without it the
 * encoder targets the capture resolution and competes with every other leg for
 * the same uplink. Best-effort by design — an older browser that rejects the
 * parameters should degrade, never break the call.
 */
export async function applyMeshEncoding(pc, peerCount) {
  if (!pc || typeof pc.getSenders !== 'function') return;
  const { maxBitrate, scaleResolutionDownBy } = encodingForPeers(peerCount);
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].scaleResolutionDownBy = scaleResolutionDownBy;
      /* Prefer a steady, readable picture over a sharp, stuttering one: in a
         conference, motion smoothness reads as "working" far more than detail. */
      params.degradationPreference = 'balanced';
      // eslint-disable-next-line no-await-in-loop
      await sender.setParameters(params);
    } catch {
      /* Older browsers reject some fields — never let tuning break a call. */
    }
  }
}

/** Re-tune every leg at once, after someone joins or leaves. */
export function retuneAll(peersMap, peerCount) {
  if (!peersMap) return;
  peersMap.forEach((pc) => {
    applyMeshEncoding(pc, peerCount);
  });
}

/**
 * A one-line, honest description of what the user should expect at this size —
 * or null when the room is comfortably within mesh range.
 */
export function meshCapacityWarning(participantCount) {
  if (participantCount > MESH_HARD_LIMIT) {
    return `${participantCount} people is beyond what a peer-to-peer call can carry — video will stutter or freeze. Ask your admin to enable the meeting server (SFU) for large rooms.`;
  }
  if (participantCount > MESH_COMFORTABLE_MAX) {
    return `${participantCount} people on a peer-to-peer call — video quality is reduced to keep it running. Rooms this size are much smoother on the meeting server (SFU).`;
  }
  return null;
}

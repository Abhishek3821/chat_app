import { AccessToken } from 'livekit-server-sdk';

/**
 * LiveKit SFU integration (optional). When LIVEKIT_URL/API_KEY/API_SECRET are
 * set, meetings route their MEDIA through a LiveKit server instead of the
 * in-browser full mesh — which is what lets a room scale past ~6 people (every
 * participant sends ONE upstream to the SFU rather than one per peer). Signaling
 * for chat/reactions/hand-raise/attendance still rides our own socket room, so
 * only the media transport changes. Unset → the app uses the mesh exactly as
 * before (this whole module is a no-op).
 */
const URL = process.env.LIVEKIT_URL || '';
const KEY = process.env.LIVEKIT_API_KEY || '';
const SECRET = process.env.LIVEKIT_API_SECRET || '';

export function livekitEnabled() {
  return Boolean(URL && KEY && SECRET);
}

export function livekitUrl() {
  return URL;
}

/**
 * Mint a join token for a room. `identity` must be unique per participant
 * (we use the user id, suffixed so a user can even join from two tabs).
 * The host gets room-admin rights (server-side mute/remove) for future use.
 */
export async function createLivekitToken({ room, identity, name, isHost = false }) {
  if (!livekitEnabled()) return null;
  const at = new AccessToken(KEY, SECRET, { identity, name: name || 'Guest', ttl: '3h' });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isHost,
  });
  return at.toJwt();
}

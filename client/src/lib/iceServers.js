/**
 * Shared WebRTC ICE configuration for 1:1/group calls AND meeting rooms.
 *
 * STUN (Google) alone handles same-LAN / most home networks. A TURN relay is
 * REQUIRED for media between strict NATs (mobile networks, corporate wifi) —
 * without one those calls ring and "accept" but audio/video never flows.
 *
 * NOTE: no hardcoded default TURN. The free Open Relay service this app used to
 * fall back on (openrelay.metered.ca) has been shut down — its endpoints now
 * answer HTTP or nothing, so listing it only slowed ICE down while still
 * leaving cross-network calls without media. Configure a relay with either:
 *   - VITE_TURN_URL (+ VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL), or
 *   - VITE_TURN_CREDENTIALS_URL — an endpoint returning time-limited
 *     credentials (one ice-server object or an array), e.g. metered.ca's
 *     /api/v1/turn/credentials?apiKey=… (free tier available).
 */
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  });
} else if (import.meta.env.VITE_TURN_CREDENTIALS_URL) {
  // Fetched once at startup; connections created before it resolves fall back
  // to STUN for that session. ICE_SERVERS is read at RTCPeerConnection creation
  // time, so pushing here upgrades every subsequent call/meeting.
  fetch(import.meta.env.VITE_TURN_CREDENTIALS_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((body) => {
      const servers = (Array.isArray(body) ? body : [body]).filter((s) => s && s.urls);
      ICE_SERVERS.push(...servers);
    })
    .catch((err) => console.warn('TURN credentials fetch failed — calls fall back to STUN only:', err?.message));
}

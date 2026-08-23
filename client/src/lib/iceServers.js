import api from './api';

/**
 * WebRTC ICE configuration for 1:1 calls, group calls AND meeting rooms.
 *
 * STUN alone handles same-LAN and most home networks. A TURN relay is REQUIRED
 * for media between strict NATs (mobile data, corporate wifi) — without one those
 * calls ring, "connect", and then carry no audio or video, which is the single
 * most confusing failure mode in the whole product.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHERE THE RELAY COMES FROM (in priority order)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  1. VITE_TURN_URL (+ USERNAME / CREDENTIAL) — an explicit, static override,
 *     baked in at build time. Fine for a quick test; NOT recommended in
 *     production, because static credentials shipped to a browser are readable
 *     by anyone who opens devtools and can then relay traffic at your expense.
 *
 *  2. VITE_TURN_CREDENTIALS_URL — a third-party endpoint returning time-limited
 *     credentials (one ice-server object, or an array of them).
 *
 *  3. THE SERVER (default, and the one to use). `GET /api/v1/ice` mints
 *     time-limited coturn credentials from the operator's TURN_URL +
 *     TURN_SECRET. Configure the relay ONCE on the server and every surface
 *     gets it: this app, the drop-in embed, and any partner frontend.
 *
 * That third path did not exist before: server-side minting was added for the
 * embed only, and this file read nothing but build-time env vars — so setting
 * TURN_URL on the server fixed embeds while leaving the actual app STUN-only.
 * Two places to configure, one of them silent when missed.
 *
 * `ICE_SERVERS` is mutated in place and read at RTCPeerConnection creation time,
 * so servers that arrive after startup upgrade every subsequent call. Call
 * `ensureIceServers()` before creating the first connection to avoid starting a
 * call on STUN when a relay was available.
 */

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export const ICE_SERVERS = [...STUN];

/** True once a relay (not just STUN) is present. */
export function hasRelay() {
  return ICE_SERVERS.some((s) => /^turns?:/.test(String(Array.isArray(s.urls) ? s.urls[0] : s.urls)));
}

/** Accepts a bare object, an array, or `{ iceServers: [...] }`. */
function extractServers(body) {
  const raw = Array.isArray(body) ? body : body?.iceServers || [body];
  return (Array.isArray(raw) ? raw : [raw]).filter((s) => s && s.urls);
}

function addServers(servers) {
  for (const s of servers) {
    // Cheap de-dup: a re-fetch after expiry must not stack duplicate entries,
    // which would make ICE gathering slower every time.
    const key = JSON.stringify(s.urls);
    const existing = ICE_SERVERS.findIndex((e) => JSON.stringify(e.urls) === key && e.username !== undefined);
    if (existing >= 0) ICE_SERVERS.splice(existing, 1);
    ICE_SERVERS.push(s);
  }
}

/* ── 1. Static override, if the build supplies one ─────────────────── */
const STATIC_URL = import.meta.env.VITE_TURN_URL;
if (STATIC_URL) {
  ICE_SERVERS.push({
    urls: STATIC_URL.split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    username: import.meta.env.VITE_TURN_USERNAME || '',
    credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
  });
}

let inFlight = null;
let expiresAt = 0;

/**
 * Make sure a relay is loaded, if one is available. Idempotent and cached, and
 * safe to call on every call/meeting start — which is exactly when it should be
 * called, because credentials expire and a long-lived tab would otherwise hold
 * dead ones.
 *
 * Never rejects: no relay is a degraded call, not a broken app, and throwing
 * here would take the whole call with it.
 */
export function ensureIceServers() {
  // An explicit static override means the operator has chosen; don't second-guess.
  if (STATIC_URL) return Promise.resolve(ICE_SERVERS);
  if (inFlight) return inFlight;
  if (expiresAt && Date.now() < expiresAt && hasRelay()) return Promise.resolve(ICE_SERVERS);

  inFlight = (async () => {
    const thirdParty = import.meta.env.VITE_TURN_CREDENTIALS_URL;
    try {
      if (thirdParty) {
        const res = await fetch(thirdParty);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        addServers(extractServers(await res.json()));
        // No expiry advertised by a third-party endpoint; re-ask in an hour.
        expiresAt = Date.now() + 3600_000;
      } else {
        /* Authenticated: relay bandwidth is billable, so the server will not hand
           credentials to anonymous callers. Signing in is a precondition for
           making a call anyway. */
        /* `/v1/ice`, not `/v1/embed/ice`: same handler, but this is the app, not an
           embed. Both exist; using the embed-named path here made the call read as
           embed-only plumbing and contradicted this file's own header. */
        const { data } = await api.get('/v1/ice');
        addServers(extractServers(data));
        const ttl = Number(data?.ttlSeconds) || 3600;
        // Refresh at 80% of the lifetime so a long meeting never runs out.
        expiresAt = Date.now() + ttl * 800;
        if (data?.relay === 'stun_only' && import.meta.env.DEV) {
          console.warn('[ice]', data?.note);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[ice] no relay available — calls fall back to STUN only:', err?.message);
      }
      // Retry on the next call rather than caching the failure for an hour.
      expiresAt = 0;
    } finally {
      inFlight = null;
    }
    return ICE_SERVERS;
  })();

  return inFlight;
}

/** Drop cached credentials — call on logout, since they are scoped to the user. */
export function resetIceServers() {
  ICE_SERVERS.length = 0;
  ICE_SERVERS.push(...STUN);
  if (STATIC_URL) {
    ICE_SERVERS.push({
      urls: STATIC_URL.split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    });
  }
  expiresAt = 0;
  inFlight = null;
}

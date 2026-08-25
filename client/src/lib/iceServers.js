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

/**
 * Why a call could not connect — and the two causes are NOT the same thing.
 *
 * "The network is blocking the media path" is true when a relay was offered and
 * still nothing got through. When no relay was offered at all, that message
 * blames the user's wifi for a missing deployment setting, and sends whoever is
 * debugging it to the wrong place entirely — which is exactly how a STUN-only
 * deployment stays STUN-only for weeks.
 */
export function callFailureMessage() {
  if (hasRelay()) return 'Couldn’t connect the call — the network is blocking the media path.';
  if (import.meta.env.DEV) {
    console.warn(
      '[ice] the call failed and NO relay was offered. Set TURN_URL + TURN_SECRET (or the ' +
        'Cloudflare pair) on the API and rebuild the client. See deploy/turn/README.md.'
    );
  }
  return 'Couldn’t connect — calls between different networks need a relay server, and none is set up yet.';
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
    /* THE SERVER FIRST, the build-time URL only as a fallback.

       These were the other way round, and that ordering had a trap in it: a
       deployment that sets VITE_TURN_CREDENTIALS_URL to get calls working before
       the server is ready would keep using it FOREVER, because the better path
       is never tried again. The operator has to remember to remove a variable
       for the correct behaviour to start — and nothing tells them, since calls
       work either way.

       This order makes the build-time URL a temporary bridge that resolves
       itself: while the server has no relay it carries the calls, and the moment
       the server can mint credentials it takes over on its own. Which matters
       because the fallback is strictly worse — the URL contains a provider API
       key, it ships inside this bundle, and anyone can read it from devtools and
       spend the relay quota. */
    try {
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
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[ice] the server offered no relay:', err?.message);
      }
      expiresAt = 0;
    }

    /* Only if the server produced nothing usable. A 404 means the deployment
       predates the endpoint; `stun_only` means it is there but has no provider
       configured. Both leave hasRelay() false, and both are exactly when the
       bridge should carry the call. */
    const thirdParty = import.meta.env.VITE_TURN_CREDENTIALS_URL;
    if (!hasRelay() && thirdParty) {
      try {
        const res = await fetch(thirdParty);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        addServers(extractServers(await res.json()));
        // No expiry advertised by a third-party endpoint; re-ask in an hour.
        expiresAt = Date.now() + 3600_000;
        if (import.meta.env.DEV) {
          console.warn(
            '[ice] using VITE_TURN_CREDENTIALS_URL because the server has no relay. ' +
              'This exposes the provider key in the bundle — configure the relay on the API and drop this variable.'
          );
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[ice] the fallback credentials endpoint failed too:', err?.message);
        }
        // Retry on the next call rather than caching the failure for an hour.
        expiresAt = 0;
      }
    }

    return ICE_SERVERS;
  })().finally(() => {
    /* In a finally, not inline: anything that escaped both catch blocks would
       otherwise leave inFlight pointing at a settled promise, and every later
       call would get that stale result instead of re-fetching. */
    inFlight = null;
  });

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

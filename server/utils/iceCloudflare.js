import { cacheGetJSON, cacheSetJSON } from './cache.js';

/**
 * ICE provider: Cloudflare TURN.
 *
 * Cloudflare does not use coturn's HMAC scheme — credentials come from an
 * authenticated API call. That single difference drives everything in this file:
 * the path is async, it can fail, and it must be cached, because a call start is
 * not the moment to discover an upstream is slow.
 *
 * The API token is account-level. It never leaves the server; the browser only
 * ever receives the generated, expiring pair.
 *
 * ── Caching, and why it is two layers ────────────────────────────────────
 * Generating per request would put a Cloudflare round trip in front of every
 * call and walk straight into their rate limit under load. So:
 *
 *   1. process memory — the hot path, always on.
 *   2. Redis, when REDIS_URL is set — SHARED across instances, so a fleet of
 *      ten makes one API call between them rather than ten. Without Redis this
 *      layer is a no-op and each process keeps its own copy, which is correct,
 *      just less efficient.
 *
 * Past 80% of its life a credential is served from cache AND refreshed in the
 * background: the caller is never made to wait for a refresh it did not cause.
 * Only a completely cold cache blocks, and boot warms it precisely so that the
 * first real call does not.
 *
 * ── The trade-off worth knowing ──────────────────────────────────────────
 * One credential is shared by every user for its lifetime. That is Cloudflare's
 * model, not a shortcut here — there is no user scope to sign — so unlike the
 * coturn path, relay bandwidth cannot be attributed to an individual user.
 */

export const id = 'cloudflare';

const DEFAULT_BASE = 'https://rtc.live.cloudflare.com/v1/turn';

/* Two API shapes exist and both are live. The current one returns an ARRAY of
   ice servers; the older one a single OBJECT. Try the new path, fall back on
   404/405, and remember which answered so it is one request per refresh. */
const API_PATHS = ['credentials/generate-ice-servers', 'credentials/generate'];

/* A call is starting when this runs on a cold cache. Waiting on Cloudflare must
   not become the reason the call feels slow — give up and let the call proceed
   on whatever else is configured. */
const TIMEOUT_MS = 4000;

/* Below an hour, refreshing costs more than it protects. */
const MIN_TTL = 3600;

const REDIS_KEY = 'ice:cloudflare:credential';

let memo = null; // { servers, fetchedAt, ttl }
let inFlight = null;
let workingPath = null;
let failureLogged = false;

export function configured() {
  return Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN);
}

/** This provider is one relay network, however many URLs it returns. */
export function count() {
  return configured() ? 1 : 0;
}

export function warnings() {
  if (!configured()) return [];
  if (process.env.CLOUDFLARE_TURN_KEY_ID && !process.env.CLOUDFLARE_TURN_API_TOKEN) {
    return ['CLOUDFLARE_TURN_KEY_ID is set but CLOUDFLARE_TURN_API_TOKEN is not — the provider is inactive.'];
  }
  return [];
}

const clampTtl = (ttl) => Math.min(Math.max(Number(ttl) || 0, MIN_TTL), 24 * 3600);

/** Accepts `{iceServers: {...}}`, `{iceServers: [...]}`, or a bare object/array. */
function normalize(body) {
  const raw = body && body.iceServers !== undefined ? body.iceServers : body;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((s) => s && s.urls)
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
        .map((u) => String(u).trim())
        /* Cloudflare bundles its STUN server into the same entry. Drop it: STUN
           is already first in the assembled list, and a duplicate only adds a
           candidate to gather. The relay URLs are what need the credential. */
        .filter((u) => /^turns?:/i.test(u));
      if (!urls.length) return null;
      return { urls, username: String(s.username || ''), credential: String(s.credential || '') };
    })
    .filter((s) => s && s.username && s.credential);
}

async function request(path, ttl) {
  const base = String(process.env.CLOUDFLARE_TURN_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${base}/keys/${encodeURIComponent(process.env.CLOUDFLARE_TURN_KEY_ID)}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Cloudflare TURN API responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const servers = normalize(await res.json());
  if (!servers.length) throw new Error('Cloudflare TURN API returned no usable relay');
  return servers;
}

async function generate(ttl) {
  const paths = workingPath ? [workingPath] : API_PATHS;
  let last;
  for (const path of paths) {
    try {
      const servers = await request(path, ttl);
      workingPath = path;
      return servers;
    } catch (err) {
      last = err;
      /* Only a missing endpoint is worth retrying on the other path. A 401 is a
         bad token and a 429 is a rate limit — both fail the same way twice, and
         retrying doubles the delay in front of a call. */
      if (err.status !== 404 && err.status !== 405) throw err;
    }
  }
  throw last;
}

const ageSeconds = (entry) => (Date.now() - entry.fetchedAt) / 1000;
const isFresh = (entry) => entry && ageSeconds(entry) < entry.ttl * 0.8;
const isUsable = (entry) => entry && ageSeconds(entry) < entry.ttl;

/** Fetch, then publish to both cache layers. Single-flight per process. */
function refresh(ttl) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const servers = await generate(ttl);
      memo = { servers, fetchedAt: Date.now(), ttl };
      // Shared so the rest of the fleet skips its own API call. Best-effort:
      // cacheSetJSON is a no-op without Redis and swallows its own errors.
      await cacheSetJSON(REDIS_KEY, memo, ttl);
      failureLogged = false;
      return servers;
    } catch (err) {
      /* Logged once, not per request: this runs on every call start, and a bad
         token would otherwise bury every other line in the log. */
      if (!failureLogged) {
        failureLogged = true;
        console.warn(`⚠️  Cloudflare TURN unavailable (${err.message}) — falling back to whatever else is configured.`);
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * @returns {Promise<{entries: object[], ttl: number}>} `entries` is empty when
 * the provider is off or unreachable — never a rejection. A missing relay is a
 * degraded call; a thrown error here would be NO call, because the whole /ice
 * request would 500 and the caller would not even get STUN back.
 */
export async function entries(_scope, ttl = 4 * 3600) {
  if (!configured()) return { entries: [], ttl };
  const want = clampTtl(ttl);

  if (isFresh(memo)) return { entries: memo.servers, ttl: remainingTtl() };

  // Another instance may already have paid for one.
  if (!memo) {
    const shared = await cacheGetJSON(REDIS_KEY);
    if (shared && Array.isArray(shared.servers) && shared.fetchedAt) {
      memo = shared;
      if (isFresh(memo)) return { entries: memo.servers, ttl: remainingTtl() };
    }
  }

  if (isUsable(memo)) {
    /* Stale but still valid at the relay. Serve it and refresh behind the
       caller — making them wait for a refresh they did not cause would put
       Cloudflare's latency in front of a call start for no benefit. */
    refresh(want).catch(() => {});
    return { entries: memo.servers, ttl: remainingTtl() };
  }

  try {
    const servers = await refresh(want);
    return { entries: servers, ttl: remainingTtl() };
  } catch {
    // Already logged in refresh(). Degrade rather than fail the call.
    return { entries: [], ttl: want };
  }
}

/**
 * Seconds of life left in the cached credential, or null if there is none.
 *
 * Not the same number as the ttl requested: a cached credential is served until
 * 80% of its life is gone, so by then only 20% remains. Telling a browser
 * otherwise is how a long meeting ends up holding a dead credential — it would
 * not re-fetch until well after the relay stopped accepting it, and the call
 * would lose media mid-sentence.
 */
export function remainingTtl() {
  if (!memo) return null;
  return Math.max(0, Math.floor(memo.ttl - ageSeconds(memo)));
}

/**
 * Validate the credentials and warm the cache, at boot.
 *
 * Without this a bad token is discovered by the first user who tries to call,
 * which is both the worst time and the hardest place to see it. Deliberately
 * fire-and-forget and never fatal: the deployment is still perfectly usable on
 * STUN plus any self-hosted relay, and refusing to boot over a relay provider
 * would turn a degraded feature into an outage.
 */
export async function verifyAtBoot() {
  if (!configured()) return { ok: false, skipped: true };
  try {
    const servers = await refresh(clampTtl(4 * 3600));
    const hosts = servers.flatMap((s) => s.urls).length;
    return { ok: true, note: `${hosts} relay url(s), credential cached for ${remainingTtl()}s` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Test seam: forget the cached credential and the learned API path. */
export function resetCache() {
  memo = null;
  inFlight = null;
  workingPath = null;
  failureLogged = false;
}

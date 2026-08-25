import { createCredentialCache, normalizeIceEntries } from './iceCredentialCache.js';

/**
 * ICE provider: Cloudflare TURN.
 *
 * Cloudflare does not use coturn's HMAC scheme — credentials come from an
 * authenticated POST, so this path is async, cacheable, and able to fail. The
 * caching, single-flight, stale-while-revalidate and never-throw behaviour all
 * live in iceCredentialCache.js; only the request itself is here.
 *
 * The API token is account-level. It never leaves the server; the browser only
 * ever receives the generated, expiring pair.
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

const TIMEOUT_MS = 4000;
const DEFAULT_TTL = 4 * 3600;

let workingPath = null;

export function configured() {
  return Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN);
}

/** One managed relay network, however many urls it returns. */
export function count() {
  return configured() ? 1 : 0;
}

export function warnings() {
  const out = [];
  const key = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (key && !token) out.push('CLOUDFLARE_TURN_KEY_ID is set but CLOUDFLARE_TURN_API_TOKEN is not — the provider is inactive.');
  if (token && !key) out.push('CLOUDFLARE_TURN_API_TOKEN is set but CLOUDFLARE_TURN_KEY_ID is not — the provider is inactive.');
  return out;
}

async function request(apiPath, ttl) {
  const base = String(process.env.CLOUDFLARE_TURN_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${base}/keys/${encodeURIComponent(process.env.CLOUDFLARE_TURN_KEY_ID)}/${apiPath}`;
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
  return normalizeIceEntries(await res.json());
}

const cache = createCredentialCache({
  id: 'Cloudflare',
  redisKey: 'ice:cloudflare:credential',
  defaultTtl: DEFAULT_TTL,
  minTtl: 3600,
  async fetch(ttl) {
    const paths = workingPath ? [workingPath] : API_PATHS;
    let last;
    for (const apiPath of paths) {
      try {
        const servers = await request(apiPath, ttl);
        workingPath = apiPath;
        return servers;
      } catch (err) {
        last = err;
        /* Only a missing endpoint is worth retrying on the other path. A 401 is
           a bad token and a 429 is a rate limit — both fail the same way twice,
           and retrying only doubles the delay sitting in front of a call. */
        if (err.status !== 404 && err.status !== 405) throw err;
      }
    }
    throw last;
  },
});

export async function entries(_scope, ttl = DEFAULT_TTL) {
  if (!configured()) return { entries: [], ttl };
  return cache.entries(ttl);
}

export const remainingTtl = () => cache.remainingTtl();

/** Test seam: forget the cached credential and the learned API path. */
export function resetCache() {
  cache.reset();
  workingPath = null;
}

/**
 * Boot-time check: prove the credentials work and warm the cache.
 *
 * Without it a bad token is discovered by the first user who tries to call.
 * Deliberately never fatal — the deployment is still usable on STUN plus any
 * other provider, and refusing to boot over a relay provider would turn a
 * degraded feature into an outage.
 */
export async function verifyAtBoot() {
  if (!configured()) return { ok: false, skipped: true };
  return cache.verify();
}

import { createCredentialCache, normalizeIceEntries } from './iceCredentialCache.js';

/**
 * ICE provider: metered.ca (Open Relay).
 *
 * Credentials come from one authenticated GET:
 *
 *   https://<subdomain>.metered.live/api/v1/turn/credentials?apiKey=<key>
 *
 * and it answers with an array of ice-server objects — one STUN entry plus four
 * relay entries (UDP:80, TCP:80, UDP:443, TLS:443). Port 80 and 443 are the
 * point: a network that blocks everything else usually still lets those out, and
 * `turns:` on 443 looks like ordinary HTTPS to a firewall inspecting packets.
 *
 * ── THE API KEY IS THE CREDENTIAL ────────────────────────────────────────
 * It sits in the query string, so the whole URL is a secret. That is exactly why
 * this belongs on the server: putting the URL in `VITE_TURN_CREDENTIALS_URL`
 * bakes the key into the JavaScript bundle, where anyone can read it out of
 * devtools and spend your relay quota. The browser only ever receives the
 * generated username/credential pair, never the key that produced it.
 *
 * ── The one thing this API does not tell us ──────────────────────────────
 * The response carries no expiry. So rather than invent a long lifetime and risk
 * handing a browser a credential that dies mid-meeting, the cache assumes a
 * short one and re-fetches. A handful of API calls a day is not a cost worth
 * optimising against a call losing its media.
 */

export const id = 'metered';

/* No advertised expiry, so this is a deliberate assumption, not a fact. Short
   enough that a stale credential is never handed out for long; long enough that
   a busy deployment makes a few requests a day, not one per call. */
const CACHE_TTL = 3600;

const TIMEOUT_MS = 4000;

export function configured() {
  return Boolean(process.env.METERED_API_KEY && process.env.METERED_SUBDOMAIN);
}

/** One managed relay network, however many transports it returns. */
export function count() {
  return configured() ? 1 : 0;
}

export function warnings() {
  const out = [];
  const key = process.env.METERED_API_KEY;
  const sub = process.env.METERED_SUBDOMAIN;
  if (key && !sub) out.push('METERED_API_KEY is set but METERED_SUBDOMAIN is not — the provider is inactive.');
  if (sub && !key) out.push('METERED_SUBDOMAIN is set but METERED_API_KEY is not — the provider is inactive.');
  /* A full URL in the subdomain field is the obvious mistake, and it produces a
     404 that reads as "the provider is down" rather than "you pasted too much". */
  if (sub && /[./:]/.test(sub)) {
    out.push(`METERED_SUBDOMAIN should be just the subdomain (e.g. "chatkonect"), not "${sub}".`);
  }
  return out;
}

function credentialsUrl() {
  const base = String(
    process.env.METERED_API_BASE || `https://${process.env.METERED_SUBDOMAIN}.metered.live`
  ).replace(/\/+$/, '');
  return `${base}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`;
}

const cache = createCredentialCache({
  id: 'metered.ca',
  redisKey: 'ice:metered:credential',
  defaultTtl: CACHE_TTL,
  minTtl: 600,
  async fetch() {
    const res = await fetch(credentialsUrl(), {
      // A call is starting when this runs on a cold cache. Waiting on a third
      // party must not become the reason the call feels slow.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`metered.ca API responded ${res.status}${res.status === 401 ? ' (check METERED_API_KEY)' : ''}`);
      err.status = res.status;
      throw err;
    }
    // Returns a bare array, and `urls` is a STRING per entry, not an array.
    return normalizeIceEntries(await res.json());
  },
});

export async function entries(_scope, ttl = CACHE_TTL) {
  if (!configured()) return { entries: [], ttl };
  /* The caller's requested ttl is deliberately IGNORED here.

     A provider may only promise a lifetime it actually controls. coturn mints
     to order and Cloudflare accepts a ttl in the request, so both can honour
     what they are asked for. metered.ca does neither: the response carries no
     expiry at all. Passing 4h through would cache the credential for 4h AND
     report 4h to the browser — which then refreshes at 80% of a number nobody
     ever promised. A meeting outliving its credential loses media mid-sentence,
     and the cause is invisible from the client. So this uses its own short,
     conservative window instead. */
  return cache.entries(CACHE_TTL);
}

export const remainingTtl = () => cache.remainingTtl();
export const resetCache = () => cache.reset();

/** Boot-time check: prove the key works and warm the cache. Never fatal. */
export async function verifyAtBoot() {
  if (!configured()) return { ok: false, skipped: true };
  return cache.verify();
}

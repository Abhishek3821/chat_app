import crypto from 'crypto';

/**
 * ICE server configuration, minted server-side.
 *
 * Embedding partners kept having to stand up their own TURN relay, because the
 * only relay configuration in the project was `VITE_TURN_*` — a BUILD-TIME
 * variable for the first-party React bundle, useless to anyone with their own
 * frontend. That pushed the single most error-prone piece of a WebRTC
 * integration onto every partner. This centralises it: the operator configures
 * the relays once, and every embed (and every partner frontend that asks)
 * receives working, time-limited credentials.
 *
 * ── TWO PROVIDERS, AND THEY COMPOSE ──────────────────────────────────────
 *
 *   1. YOUR OWN relays (coturn) — `TURN_URL` + `TURN_SECRET`.
 *   2. CLOUDFLARE TURN — `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN`.
 *
 * Set either, or both. With both, your own relays are listed FIRST and
 * Cloudflare acts as the fallback: yours is cheaper and you control it, but if
 * the box is down or unreachable the browser walks on to Cloudflare's anycast
 * network instead of failing the call. That is the cheapest possible redundancy
 * and it is why the two are additive rather than exclusive.
 *
 * ── The coturn scheme (provider 1) ───────────────────────────────────────
 *
 *   username   = "<unix-expiry>:<user-scope>"
 *   credential = base64( HMAC-SHA1( static-auth-secret, username ) )
 *
 * coturn recomputes the HMAC from the username it receives, so nothing has to
 * be stored or synchronised — and because the expiry is INSIDE the signed
 * username, a credential that leaks out of a browser stops working on its own.
 * Never hand out the static secret itself, and never a non-expiring pair.
 *
 * ── Running a NETWORK of your own relays ─────────────────────────────────
 * One relay is a single point of failure and a single location, and a relay
 * adds a round trip — so a user far from it pays for the distance on every
 * packet. Several relays fix both, and the browser handles the choice: it tries
 * the ICE servers in order and uses whichever answers.
 *
 * Two shapes are supported, and the difference matters:
 *
 *   Same secret everywhere (simplest — your own boxes, one config):
 *     TURN_URL=turn:a.example.com:3478?transport=udp,turn:b.example.com:3478?transport=udp
 *     TURN_SECRET=one-shared-secret
 *   → ONE ICE entry whose `urls` lists every relay. Correct, because the
 *     credential is valid at all of them.
 *
 *   Independent secrets (regions, or different providers — recommended at scale):
 *     TURN_URL=turn:in.example.com:3478?transport=udp,turns:in.example.com:5349 | turn:eu.example.com:3478
 *     TURN_SECRET=secret-for-india | secret-for-europe
 *   → one ICE entry PER GROUP, each with its own credential. `|` separates
 *     groups, `,` separates URLs within a group, and the two lists are matched
 *     positionally.
 *
 * Independent secrets are worth the extra config: a shared secret means one
 * leaked or compromised box hands an attacker free bandwidth on every relay you
 * own, and rotating it takes all of them down at once.
 */

const STUN_ONLY = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** Too many entries slows ICE gathering measurably; nobody needs more. */
const MAX_GROUPS = 6;

/** Split on `|` into groups, then on `,` into URLs. Blank pieces are dropped. */
const parseGroups = (raw) =>
  String(raw || '')
    .split('|')
    .map((group) =>
      group
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    )
    .filter((urls) => urls.length > 0);

const parseSecrets = (raw) =>
  String(raw || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

export function isTurnConfigured() {
  return Boolean(process.env.TURN_URL && process.env.TURN_SECRET);
}

/**
 * The configured relays, paired with the secret each one is signed with.
 *
 * When there is one secret and many groups, every group uses it — that is the
 * "same secret everywhere" case above. Otherwise groups and secrets are matched
 * positionally, and a group with no matching secret is DROPPED rather than
 * signed with someone else's: a credential the relay will reject is worse than
 * no credential, because the browser wastes ICE time on it before failing.
 */
export function relayGroups() {
  if (!isTurnConfigured()) return [];
  const groups = parseGroups(process.env.TURN_URL).slice(0, MAX_GROUPS);
  const secrets = parseSecrets(process.env.TURN_SECRET);
  if (!groups.length || !secrets.length) return [];

  return groups
    .map((urls, i) => ({ urls, secret: secrets.length === 1 ? secrets[0] : secrets[i] }))
    .filter((g) => Boolean(g.secret));
}

/** How many relays are misconfigured — a group with no secret to sign it. */
export function relayConfigWarnings() {
  if (!isTurnConfigured()) return [];
  const groups = parseGroups(process.env.TURN_URL);
  const secrets = parseSecrets(process.env.TURN_SECRET);
  const out = [];
  if (groups.length > MAX_GROUPS) {
    out.push(`${groups.length} relay groups configured; only the first ${MAX_GROUPS} are used (more slows ICE gathering).`);
  }
  if (secrets.length > 1 && secrets.length !== groups.length) {
    out.push(
      `TURN_URL has ${groups.length} relay group(s) but TURN_SECRET has ${secrets.length} secret(s). ` +
        'They are matched positionally, so the unmatched groups are dropped. Use ONE secret for all, or one per group.'
    );
  }
  return out;
}

/**
 * @param {string} scope  Opaque label baked into the signed username — a user id
 *                        or app id. Lets an operator attribute relay bandwidth
 *                        to a tenant in coturn's logs. Colons are stripped
 *                        because the username format is colon-delimited.
 * @param {number} ttlSeconds  Credential lifetime. Kept short: these travel to
 *                        a browser, and the expiry is the only thing limiting
 *                        the damage if one is copied out.
 */
export function iceServersFor(scope = '', ttlSeconds = 4 * 3600) {
  const groups = relayGroups();
  if (!groups.length) return STUN_ONLY;

  const ttl = Math.min(Math.max(Number(ttlSeconds) || 0, 300), 24 * 3600);
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${String(scope).replace(/:/g, '_').slice(0, 64) || 'embed'}`;

  /* One entry per group, each signed with ITS OWN secret. The username is the
     same across them on purpose — it carries only the expiry and the scope, and
     each relay verifies it against the secret it holds. Order is preserved:
     the browser tries them in the order given, so put the nearest relay first. */
  return [
    ...STUN_ONLY,
    ...groups.map(({ urls, secret }) => ({
      urls,
      username,
      credential: crypto.createHmac('sha1', String(secret)).update(username).digest('base64'),
    })),
  ];
}

/* ═══════════════════════════════════════════════════════════════════════
   Provider 2: Cloudflare TURN
   ═══════════════════════════════════════════════════════════════════════
   Cloudflare does NOT use coturn's HMAC scheme — credentials come from an
   authenticated API call, so this path is async and cached. The API token is
   account-level: it must never reach a browser, which is exactly why this lives
   on the server and the client only ever sees the generated pair.

   One generated credential is shared by every user for its lifetime. That is
   Cloudflare's model, not a shortcut — there is no per-user scope to sign, so
   unlike the coturn path, relay usage cannot be attributed to a single user.
   Worth knowing before choosing a provider. */

const CF_DEFAULT_BASE = 'https://rtc.live.cloudflare.com/v1/turn';

/* Two API shapes exist. The current one returns an ARRAY of ice servers, the
   older one a single OBJECT. Try the new path, fall back on 404/405, and
   remember which answered so it is one request per refresh after that. */
const CF_PATHS = ['credentials/generate-ice-servers', 'credentials/generate'];

/* A call is starting when this runs. Waiting on Cloudflare is not allowed to
   become the reason the call feels slow — give up and let the call proceed on
   whatever else is configured. */
const CF_TIMEOUT_MS = 4000;

/* Below an hour, refreshing costs more than it protects: these are re-fetched
   at 80% of their life and a call rarely outlives that. */
const CF_MIN_TTL = 3600;

let cfCache = null; // { servers, fetchedAt, ttl }
let cfInFlight = null;
let cfWorkingPath = null;
let cfFailureLogged = false;

export function isCloudflareTurnConfigured() {
  return Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN);
}

/** Accepts `{iceServers: {...}}`, `{iceServers: [...]}`, or a bare object/array. */
function cfNormalize(body) {
  const raw = body && body.iceServers !== undefined ? body.iceServers : body;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((s) => s && s.urls)
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
        .map((u) => String(u).trim())
        /* Cloudflare bundles its STUN server into the same entry. Drop it: STUN
           is already first in the list, and a duplicate only adds a candidate
           to gather. The relay URLs are the part that needs the credential. */
        .filter((u) => /^turns?:/i.test(u));
      if (!urls.length) return null;
      return { urls, username: String(s.username || ''), credential: String(s.credential || '') };
    })
    .filter((s) => s && s.username && s.credential);
}

async function cfRequest(path, ttl) {
  const base = String(process.env.CLOUDFLARE_TURN_API_BASE || CF_DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${base}/keys/${encodeURIComponent(process.env.CLOUDFLARE_TURN_KEY_ID)}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(CF_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Cloudflare TURN API responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const servers = cfNormalize(await res.json());
  if (!servers.length) throw new Error('Cloudflare TURN API returned no usable relay');
  return servers;
}

async function cfGenerate(ttl) {
  const paths = cfWorkingPath ? [cfWorkingPath] : CF_PATHS;
  let last;
  for (const path of paths) {
    try {
      const servers = await cfRequest(path, ttl);
      cfWorkingPath = path;
      return servers;
    } catch (err) {
      last = err;
      // Only a missing/wrong endpoint is worth retrying on the other path. A 401
      // is a bad token and a 429 is a rate limit — both fail the same way twice.
      if (err.status !== 404 && err.status !== 405) throw err;
    }
  }
  throw last;
}

/**
 * Cloudflare relay entries, cached. Never throws: no relay is a degraded call,
 * but a thrown error here is NO call — the whole /ice request would 500 and the
 * caller would not even get STUN.
 */
export async function cloudflareIceServers(ttlSeconds = 4 * 3600) {
  if (!isCloudflareTurnConfigured()) return [];

  const ttl = Math.min(Math.max(Number(ttlSeconds) || 0, CF_MIN_TTL), 24 * 3600);
  // Refresh at 80% of the lifetime, so nothing is ever handed out nearly dead.
  if (cfCache && Date.now() - cfCache.fetchedAt < cfCache.ttl * 800) return cfCache.servers;
  if (cfInFlight) return cfInFlight;

  cfInFlight = (async () => {
    try {
      const servers = await cfGenerate(ttl);
      cfCache = { servers, fetchedAt: Date.now(), ttl };
      cfFailureLogged = false;
      return servers;
    } catch (err) {
      /* Logged once, not per request: this runs on every call start, and a bad
         token would otherwise bury every other line in the log. */
      if (!cfFailureLogged) {
        cfFailureLogged = true;
        console.warn(`⚠️  Cloudflare TURN unavailable (${err.message}) — falling back to whatever else is configured.`);
      }
      // Stale but not yet expired still works at the relay. Better than nothing.
      if (cfCache && Date.now() - cfCache.fetchedAt < cfCache.ttl * 1000) return cfCache.servers;
      return [];
    } finally {
      cfInFlight = null;
    }
  })();

  return cfInFlight;
}

/**
 * Seconds of life left in the CACHED credential, or null if there is none.
 *
 * Not the same number as the ttl that was requested: a cached credential is
 * handed out until 80% of its life is gone, so by then it has only 20% left.
 * Telling a browser otherwise is how a long meeting ends up holding a dead
 * credential — it would not re-fetch until long after the relay stopped
 * accepting it, and the call would lose media mid-sentence.
 */
export function cloudflareRemainingTtl() {
  if (!cfCache) return null;
  const elapsed = (Date.now() - cfCache.fetchedAt) / 1000;
  return Math.max(0, Math.floor(cfCache.ttl - elapsed));
}

/** Test seam: drops the cached Cloudflare credential and the learned API path. */
export function resetCloudflareCache() {
  cfCache = null;
  cfInFlight = null;
  cfWorkingPath = null;
  cfFailureLogged = false;
}

/* ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything a browser needs, from every configured provider.
 *
 * Order is the whole point: STUN, then your own relays, then Cloudflare. The
 * browser tries them in order, so a working self-hosted relay is used and
 * Cloudflare is only reached for when it is not.
 */
export async function resolveIceServers(scope = '', ttlSeconds = 4 * 3600) {
  const requested = Math.min(Math.max(Number(ttlSeconds) || 0, 300), 24 * 3600);
  const own = iceServersFor(scope, requested);
  const cf = await cloudflareIceServers(requested);

  /* The reported ttl is the SHORTEST life among what we are handing out, since
     the client refreshes all of it as one bundle. The self-hosted credential is
     minted right now and lasts exactly `requested`; a Cloudflare one may be most
     of the way through its life already. */
  let ttl = requested;
  if (cf.length) {
    const remaining = cloudflareRemainingTtl();
    if (remaining !== null) ttl = Math.max(60, Math.min(ttl, remaining));
  }
  return { iceServers: cf.length ? [...own, ...cf] : own, ttlSeconds: ttl };
}

/** What a client should be told about relay availability, without leaking config. */
export function turnStatus() {
  const own = relayGroups().length;
  const cf = isCloudflareTurnConfigured();
  const providers = [];
  if (own) providers.push('self-hosted');
  if (cf) providers.push('cloudflare');

  if (!own && !cf) {
    return {
      relay: 'stun_only',
      relayCount: 0,
      providers,
      // A partner debugging "the call connects but has no media" needs to know
      // whether a relay was even offered before they suspect their own code.
      note: 'No TURN relay configured on this deployment — calls will fail between strict/symmetric NATs. Set TURN_URL + TURN_SECRET, or CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN.',
    };
  }

  const count = own + (cf ? 1 : 0);
  let note;
  if (own && cf) {
    note = `Time-limited TURN credentials for ${own} self-hosted relay${own === 1 ? '' : 's'} plus Cloudflare as fallback, in preference order.`;
  } else if (cf) {
    note = 'Time-limited Cloudflare TURN credentials are included in iceServers.';
  } else {
    note =
      own === 1
        ? 'Time-limited TURN credentials are included in iceServers.'
        : `Time-limited TURN credentials for ${own} relays are included in iceServers, in preference order.`;
  }
  return { relay: 'configured', relayCount: count, providers, note };
}

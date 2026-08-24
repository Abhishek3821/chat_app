import crypto from 'crypto';

/**
 * ICE provider: your own coturn relays.
 *
 * The credential scheme is coturn's `use-auth-secret` (the "TURN REST API"):
 *
 *   username   = "<unix-expiry>:<user-scope>"
 *   credential = base64( HMAC-SHA1( static-auth-secret, username ) )
 *
 * coturn recomputes the HMAC from the username it receives, so nothing is
 * stored or synchronised anywhere — and because the expiry is INSIDE the signed
 * username, a credential that leaks out of a browser stops working on its own.
 * Never hand out the static secret itself, and never a non-expiring pair.
 *
 * Everything here is local arithmetic: no network, no cache, no failure mode.
 * That is the main practical difference from the managed providers, and it is
 * why this one is always listed first when several are configured.
 *
 * ── A NETWORK of relays ──────────────────────────────────────────────────
 * One relay is a single point of failure in a single location, and a relay adds
 * a round trip, so a user far from it pays for the distance on every packet.
 * `TURN_URL` therefore accepts several:
 *
 *   Same secret on every box (simplest):
 *     TURN_URL=turn:a.example.com:3478?transport=udp,turn:b.example.com:3478
 *     TURN_SECRET=one-shared-secret
 *   → ONE entry whose `urls` lists both, which is correct because the
 *     credential is valid at either.
 *
 *   Independent secrets (recommended once there is more than one):
 *     TURN_URL=turn:in.example.com:3478,turns:in.example.com:5349 | turn:eu.example.com:3478
 *     TURN_SECRET=secret-for-india | secret-for-europe
 *   → one entry PER GROUP, each signed with its own secret. `|` separates
 *     groups, `,` separates URLs within a group, matched positionally.
 *
 * Independent secrets are worth the extra config: a shared secret means one
 * compromised box hands an attacker free bandwidth on every relay you own, and
 * rotating it takes all of them down at once.
 */

export const id = 'self-hosted';

/** More than this slows ICE gathering measurably, for no reachability gain. */
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

export function configured() {
  return Boolean(process.env.TURN_URL && process.env.TURN_SECRET);
}

/**
 * The configured relays, each paired with the secret it is signed with.
 *
 * One secret and many groups means every group uses it — the "same secret
 * everywhere" case. Otherwise groups and secrets are matched positionally, and
 * a group with no matching secret is DROPPED rather than signed with someone
 * else's: a credential the relay will reject is worse than no credential,
 * because the browser spends ICE time on it before failing, which presents
 * exactly like an outage.
 */
export function relays() {
  if (!configured()) return [];
  const groups = parseGroups(process.env.TURN_URL).slice(0, MAX_GROUPS);
  const secrets = parseSecrets(process.env.TURN_SECRET);
  if (!groups.length || !secrets.length) return [];

  return groups
    .map((urls, i) => ({ urls, secret: secrets.length === 1 ? secrets[0] : secrets[i] }))
    .filter((g) => Boolean(g.secret));
}

/** How many relays this provider is offering. */
export function count() {
  return relays().length;
}

/** Misconfigurations an operator would otherwise never see. */
export function warnings() {
  if (!configured()) return [];
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
 * @param {string} scope  Opaque label baked into the signed username — a user or
 *                        app id, so an operator can attribute relay bandwidth to
 *                        a tenant in coturn's logs. Colons are stripped because
 *                        the username format is colon-delimited.
 * @param {number} ttl    Already-clamped credential lifetime in seconds.
 * @returns {{entries: object[], ttl: number}}
 */
export function entries(scope = '', ttl = 4 * 3600) {
  const groups = relays();
  if (!groups.length) return { entries: [], ttl };

  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${String(scope).replace(/:/g, '_').slice(0, 64) || 'embed'}`;

  /* The username is deliberately the same across groups: it carries only the
     expiry and the scope, and each relay verifies it against the secret it
     holds. Order is preserved — the browser tries them in the order given, so
     the nearest relay must be listed first. */
  return {
    entries: groups.map(({ urls, secret }) => ({
      urls,
      username,
      credential: crypto.createHmac('sha1', String(secret)).update(username).digest('base64'),
    })),
    // Minted right now, so the full lifetime is available.
    ttl,
  };
}

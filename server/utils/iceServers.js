import * as coturn from './iceCoturn.js';
import * as metered from './iceMetered.js';
import * as cloudflare from './iceCloudflare.js';

/**
 * ICE configuration, assembled server-side and handed to browsers by
 * `GET /api/v1/ice`.
 *
 * WHY THIS IS SERVER-SIDE AT ALL
 * Relay configuration used to be `VITE_TURN_*` — build-time variables in the
 * React bundle, world-readable and useless to anyone with their own frontend.
 * That pushed the most error-prone part of a WebRTC integration onto every
 * partner, and meant the app and the embed had to be configured separately (and
 * one of them was always missed). Now the operator configures relays once, here,
 * and every surface — 1:1 calls, group calls, meetings, the drop-in embed, any
 * partner frontend — gets working, time-limited credentials from one endpoint.
 *
 * PROVIDERS
 * Each provider module exports the same small interface, so adding one is a file
 * and a line in PROVIDERS rather than a change to any consumer:
 *
 *   id          string, shown in status and boot output
 *   configured() boolean — is this provider switched on
 *   count()     how many relay networks it represents
 *   warnings()  string[] of misconfigurations to report at boot
 *   entries(scope, ttl) → {entries, ttl}  (may be async; must never reject)
 *
 * ORDER IS THE POLICY. The browser tries ICE servers in the order given, so the
 * array order decides which relay carries the call. Self-hosted comes before
 * managed on purpose: it is yours, it is cheaper, and a managed provider should
 * only be paid for when your own relay cannot carry the call. Add both and you
 * get failover for the price of a config line.
 */

/* STUN first, always, and it costs nothing to include: most calls connect
   directly and never touch a relay at all. It is also what makes a
   no-relay deployment still work on a LAN instead of not working. */
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/**
 * Preference order — this array IS the routing policy.
 *
 * Self-hosted first: it is yours, it costs a flat rate rather than per GB, and
 * a metered provider should only be paid for when your own relay cannot carry
 * the call. Between two managed providers the order is arbitrary and safe to
 * change; only configured ones ever appear.
 */
const PROVIDERS = [coturn, metered, cloudflare];

const clampTtl = (ttl) => Math.min(Math.max(Number(ttl) || 0, 300), 24 * 3600);

/** Providers that are switched on, in preference order. */
export function activeProviders() {
  return PROVIDERS.filter((p) => p.configured());
}

export function relayConfigured() {
  return activeProviders().length > 0;
}

/**
 * Everything a browser needs, from every configured provider.
 *
 * @param   {string} scope       user or app id, for per-tenant attribution where
 *                               the provider supports it
 * @param   {number} ttlSeconds  requested credential lifetime
 * @returns {Promise<{iceServers: object[], ttlSeconds: number}>}
 *
 * The returned ttl is the SHORTEST life among the credentials handed out, not
 * the requested one, because the client refreshes the whole bundle as a unit. A
 * cached managed credential can be most of the way through its life already;
 * reporting the nominal figure would let a long meeting outlive it.
 */
export async function resolveIceServers(scope = '', ttlSeconds = 4 * 3600) {
  const requested = clampTtl(ttlSeconds);
  const active = activeProviders();
  if (!active.length) return { iceServers: [...STUN], ttlSeconds: requested };

  /* Providers are independent, so they resolve concurrently — one slow managed
     API must not add its latency to a self-hosted relay that needs no network
     at all. Order is restored from PROVIDERS, not from whichever finished
     first. */
  const results = await Promise.all(
    active.map(async (p) => {
      try {
        return await p.entries(scope, requested);
      } catch (err) {
        /* A provider is expected to handle its own failures and return an empty
           list. This is the backstop: one misbehaving provider must not take
           down an endpoint that other providers could still answer. */
        console.warn(`⚠️  ICE provider "${p.id}" threw (${err.message}) — skipping it for this request.`);
        return { entries: [], ttl: requested };
      }
    })
  );

  const iceServers = [...STUN];
  let ttl = requested;
  results.forEach((r) => {
    if (!r || !Array.isArray(r.entries) || !r.entries.length) return;
    iceServers.push(...r.entries);
    if (Number.isFinite(r.ttl)) ttl = Math.min(ttl, r.ttl);
  });

  return { iceServers, ttlSeconds: Math.max(60, ttl) };
}

/**
 * What a client may be told about relay availability, without leaking config.
 *
 * Honest degradation is the point. A partner debugging "the call connects but
 * has no media" needs to know whether a relay was offered at all before they
 * start suspecting their own code — so a STUN-only deployment says so in the
 * response instead of looking identical to a working one.
 */
export function iceStatus() {
  const active = activeProviders();
  const providers = active.map((p) => p.id);

  if (!active.length) {
    return {
      relay: 'stun_only',
      relayCount: 0,
      providers,
      note: 'No TURN relay configured on this deployment — calls will fail between strict/symmetric NATs. Set TURN_URL + TURN_SECRET (your own coturn), or METERED_API_KEY + METERED_SUBDOMAIN, or CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN.',
    };
  }

  const relayCount = active.reduce((n, p) => n + p.count(), 0);
  const own = coturn.configured() ? coturn.count() : 0;
  const managed = providers.filter((p) => p !== coturn.id);

  let note;
  if (own && managed.length) {
    note = `Time-limited TURN credentials for ${own} self-hosted relay${own === 1 ? '' : 's'} plus ${managed.join(', ')} as fallback, in preference order.`;
  } else if (!own) {
    note = `Time-limited ${managed.join(', ')} TURN credentials are included in iceServers.`;
  } else {
    note =
      own === 1
        ? 'Time-limited TURN credentials are included in iceServers.'
        : `Time-limited TURN credentials for ${own} relays are included in iceServers, in preference order.`;
  }

  return { relay: 'configured', relayCount, providers, note };
}

/** Every provider's misconfiguration warnings, for the boot report. */
export function iceConfigWarnings() {
  return PROVIDERS.flatMap((p) => (p.configured() ? p.warnings() : []));
}

/**
 * Boot-time readiness: log what loaded, and prove the managed credentials work.
 *
 * Local HMAC providers are correct or not at parse time. A managed provider is
 * only proven by an API call, which without this happens on the first user's
 * call — the worst time and the hardest place to notice. So it is checked here,
 * which also warms the cache so that first call pays no round trip.
 *
 * Never throws and never blocks boot: a relay provider being down is a degraded
 * feature, and refusing to start over it would turn that into an outage.
 */
export async function reportIceReadiness(log = console.log, warn = console.warn) {
  const status = iceStatus();
  const active = activeProviders();

  if (status.relay !== 'configured') {
    warn('⚠️  No TURN relay (STUN only). ' + status.note);
    return status;
  }

  log(
    `🔀 TURN relay configured — ${status.relayCount} relay${status.relayCount === 1 ? '' : 's'} via ${status.providers.join(' + ')}, tried in the order listed. Calls can traverse strict/symmetric NATs.`
  );
  iceConfigWarnings().forEach((w) => warn('⚠️  TURN config: ' + w));

  /* Every provider that can fail gets proved here, in parallel. A local HMAC
     provider is correct at parse time; a managed one is only correct if its
     credentials work, and without this that is discovered by the first user to
     place a call — the worst moment and the hardest place to notice. */
  await Promise.all(
    active
      .filter((p) => typeof p.verifyAtBoot === 'function')
      .map(async (p) => {
        const check = await p.verifyAtBoot();
        if (check.skipped) return;
        if (check.ok) log(`   ✅ ${p.id} TURN credentials verified — ${check.note}`);
        else warn(`⚠️  ${p.id} TURN did not answer at boot (${check.error}). Calls will fall back to whatever else is configured.`);
      })
  );

  return status;
}

/* Re-exported so consumers and tests do not need to know which provider owns
   what. Kept deliberately small — anything more belongs behind resolveIceServers. */
export { coturn, metered, cloudflare };

import { cacheGetJSON, cacheSetJSON } from './cache.js';

/**
 * The caching every MANAGED ICE provider needs, in one place.
 *
 * A managed provider means an HTTP call, and a call start is the wrong moment to
 * make one. Every provider therefore needs the same four behaviours, and each is
 * there because of a specific way this breaks:
 *
 *   two layers      process memory for speed, Redis for SHARING — otherwise a
 *                   fleet of ten instances makes ten times the API calls and
 *                   walks into the provider's rate limit under load;
 *   single-flight   ten simultaneous call starts on one instance must produce
 *                   one request, not ten;
 *   stale-while-    past 80% of life, serve the cached credential AND refresh
 *   revalidate      behind the caller — nobody should wait for a refresh they
 *                   did not cause;
 *   never throw     a provider that throws would 500 the whole /ice request and
 *                   the caller would not even get STUN back. A missing relay is
 *                   a degraded call; a failed endpoint is no call.
 *
 * Written as a factory rather than a base class because each provider differs
 * only in how it fetches — everything above is identical, and duplicating it per
 * provider is how the third one ends up subtly different from the first two.
 */

/**
 * @param {object}   opts
 * @param {string}   opts.id          provider name, used in log lines
 * @param {string}   opts.redisKey    shared cache key
 * @param {number}   opts.defaultTtl  seconds to treat a credential as valid
 * @param {number}   [opts.minTtl]    floor for a requested ttl
 * @param {function} opts.fetch       `async (ttl) => [{urls, username, credential}]`,
 *                                    must THROW on failure — the wrapper decides
 *                                    what a failure means
 */
export function createCredentialCache({ id, redisKey, defaultTtl, minTtl = 3600, fetch: fetchCredentials }) {
  let memo = null; // { servers, fetchedAt, ttl }
  let inFlight = null;
  let failureLogged = false;

  const age = (entry) => (Date.now() - entry.fetchedAt) / 1000;
  const isFresh = (entry) => entry && age(entry) < entry.ttl * 0.8;
  const isUsable = (entry) => entry && age(entry) < entry.ttl;
  const clamp = (ttl) => Math.min(Math.max(Number(ttl) || 0, minTtl), 24 * 3600);

  function refresh(ttl) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const servers = await fetchCredentials(ttl);
        if (!Array.isArray(servers) || !servers.length) throw new Error('provider returned no usable relay');
        memo = { servers, fetchedAt: Date.now(), ttl };
        // Best-effort and shared: a no-op without Redis, and it swallows its own
        // errors, because a cache write must never fail a call.
        await cacheSetJSON(redisKey, memo, ttl);
        failureLogged = false;
        return servers;
      } catch (err) {
        /* Once, not per request: this runs on every call start, and a bad
           credential would otherwise bury every other line in the log. */
        if (!failureLogged) {
          failureLogged = true;
          console.warn(`⚠️  ${id} TURN unavailable (${err.message}) — falling back to whatever else is configured.`);
        }
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    /** @returns {Promise<{entries: object[], ttl: number}>} — never rejects. */
    async entries(ttlSeconds = defaultTtl) {
      const want = clamp(ttlSeconds);

      if (isFresh(memo)) return { entries: memo.servers, ttl: this.remainingTtl() };

      // Another instance may already have paid for one.
      if (!memo) {
        const shared = await cacheGetJSON(redisKey);
        if (shared && Array.isArray(shared.servers) && shared.fetchedAt) {
          memo = shared;
          if (isFresh(memo)) return { entries: memo.servers, ttl: this.remainingTtl() };
        }
      }

      if (isUsable(memo)) {
        // Stale but still valid at the relay. Serve now, refresh behind them.
        refresh(want).catch(() => {});
        return { entries: memo.servers, ttl: this.remainingTtl() };
      }

      try {
        const servers = await refresh(want);
        return { entries: servers, ttl: this.remainingTtl() };
      } catch {
        return { entries: [], ttl: want }; // already logged
      }
    },

    /**
     * Seconds of life left in the CACHED credential, or null if there is none.
     *
     * Not the same number as the ttl requested: a cached credential is served
     * until 80% of its life is gone, so by then only 20% remains. Telling a
     * browser otherwise is how a long meeting ends up holding a dead credential
     * — it would not re-fetch until well after the relay stopped accepting it,
     * and the call would lose media mid-sentence.
     */
    remainingTtl() {
      if (!memo) return null;
      return Math.max(0, Math.floor(memo.ttl - age(memo)));
    },

    /**
     * Prove the credentials work, and warm the cache, at boot.
     *
     * Without this a bad key is discovered by the first user who tries to call:
     * the worst moment, and the hardest place to see it.
     */
    async verify() {
      try {
        const servers = await refresh(clamp(defaultTtl));
        const urls = servers.flatMap((s) => s.urls).length;
        return { ok: true, note: `${urls} relay url(s), credential cached for ${this.remainingTtl()}s` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** Test seam. */
    reset() {
      memo = null;
      inFlight = null;
      failureLogged = false;
    },
  };
}

/**
 * Normalise whatever shape a provider returns into ICE entries.
 *
 * Providers disagree on all three axes: `{iceServers: [...]}` vs `{iceServers: {...}}`
 * vs a bare array; `urls` as a string vs an array; and whether their own STUN
 * server is bundled into the same payload. Handling that per provider is how one
 * of them ends up silently dropping half its transports.
 *
 * STUN entries are dropped deliberately — the assembled list already begins with
 * STUN, and a duplicate only adds a candidate to gather.
 */
export function normalizeIceEntries(body) {
  const raw = body && body.iceServers !== undefined ? body.iceServers : body;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((s) => s && s.urls)
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
        .map((u) => String(u).trim())
        .filter((u) => /^turns?:/i.test(u));
      if (!urls.length) return null;
      return { urls, username: String(s.username || ''), credential: String(s.credential || '') };
    })
    .filter((s) => s && s.username && s.credential);
}

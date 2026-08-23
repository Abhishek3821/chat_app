import App from '../models/App.js';

/**
 * Origins registered by embedding tenants, cached for the CORS / CSRF allowlist.
 *
 * `App.allowedOrigins` was stored but never consulted anywhere (a documented gap),
 * which had two consequences that together made self-service embedding
 * impossible:
 *
 *   1. A partner's own origin was NOT CORS-allowed, so every browser fetch from
 *      their frontend failed unless an operator added it to the global
 *      EXTRA_CORS_ORIGINS env var and redeployed — per partner.
 *   2. Because nothing read the field, pinning it bought no security either.
 *
 * Making it the source of truth fixes both: a tenant registers its origins in
 * the console, and that alone authorises its browser traffic. Empty list still
 * means "any origin" for that tenant (the documented default for local
 * development), so this only ever WIDENS access for tenants that chose to pin —
 * it never silently blocks an existing integration.
 *
 * Cached because CORS runs on literally every request and this must not become a
 * database round-trip per call. Origins change when an operator edits an app, so
 * a short TTL plus explicit invalidation on write is plenty.
 */

const TTL_MS = 60_000;

let origins = new Set();
/** Tenants that pinned NOTHING — they accept any origin, so they can't be
 *  represented in the set above and are counted separately. */
let anyOriginTenants = 0;
let loadedAt = 0;
let inFlight = null;

function normalise(raw) {
  if (!raw) return null;
  try {
    return new URL(String(raw)).origin; // strips paths/trailing slashes
  } catch {
    return String(raw).trim().replace(/\/+$/, '') || null;
  }
}

async function load() {
  const apps = await App.find({ active: true }).select('allowedOrigins').lean();
  const next = new Set();
  let anyCount = 0;
  for (const a of apps) {
    const list = (a.allowedOrigins || []).map(normalise).filter(Boolean);
    if (!list.length) anyCount += 1;
    list.forEach((o) => next.add(o));
  }
  origins = next;
  anyOriginTenants = anyCount;
  loadedAt = Date.now();
  return origins;
}

/** Prime the cache at boot so the first request isn't the one that pays for it. */
export async function primeTenantOrigins() {
  try {
    await load();
  } catch {
    /* A DB hiccup must not stop the server booting; the lazy path retries. */
  }
}

/**
 * Mark the cache stale. Cheap and synchronous, but the NEXT request still
 * answers from the old set while the reload happens behind it — so don't use
 * this when a caller needs the change to be visible immediately.
 */
export function invalidateTenantOrigins() {
  loadedAt = 0;
}

/**
 * Reload NOW and wait for it. Use this on the write path: after an operator
 * saves a tenant's origins the very next request must already be allowed,
 * otherwise the partner sees a hard "Cross-site request blocked" 403 for a
 * window they cannot see or explain.
 */
export async function refreshTenantOrigins() {
  try {
    await load();
  } catch {
    // A failed reload leaves the previous set in place and marks it stale, so
    // the lazy path retries rather than emptying the allowlist on a DB blip.
    loadedAt = 0;
  }
}

/**
 * Sync so the CORS callback and csrfGuard stay sync. A stale cache kicks off a
 * background refresh and answers from what it has; being at most TTL_MS behind
 * on an origin an operator just added is a far better trade than making every
 * request await Mongo.
 */
export function isTenantOrigin(origin) {
  const o = normalise(origin);
  if (!o) return false;
  if (Date.now() - loadedAt > TTL_MS && !inFlight) {
    inFlight = load()
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return origins.has(o);
}

/** For diagnostics / the embed config endpoint. */
export function tenantOriginStats() {
  return { pinnedOrigins: origins.size, tenantsAcceptingAnyOrigin: anyOriginTenants, loadedAt };
}

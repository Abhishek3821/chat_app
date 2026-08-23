import { ApiError } from '../utils/asyncHandler.js';
import { isTenantOrigin } from '../utils/tenantOrigins.js';

/**
 * Origin trust, in two TIERS. The distinction is the security boundary, not a
 * detail — collapsing them into one list opened a critical hole:
 *
 *   FIRST-PARTY  CLIENT_URL + EXTRA_CORS_ORIGINS (+ localhost/LAN in dev).
 *                Operator-controlled. Trusted with AMBIENT credentials, i.e.
 *                the httpOnly session cookies.
 *
 *   TENANT       Origins an embedding tenant registered on its own App.
 *                Self-service, so effectively attacker-controllable: `POST
 *                /api/apps` needs only a logged-in user, and any of them may
 *                register any origin. Trusted ONLY for requests that carry an
 *                explicit `Authorization: Bearer` token, never for ambient
 *                cookies.
 *
 * Why that split matters. Auth cookies are `SameSite=None; Secure` in production
 * (the frontend and API are different sites, so nothing else is delivered), and
 * `protect` accepts `req.cookies.token`, and `POST /auth/refresh` is
 * authenticated by the refresh cookie ALONE. So if a tenant-registered origin
 * were trusted the same way as a first-party one, then any user could sign up,
 * create an app, register `https://evil.com`, and that page could — in the
 * browser of any logged-in ChatKonect user who visited it — call
 * `/api/auth/refresh` with credentials and read a fresh access token out of the
 * response. Account takeover, reachable by anyone who can sign up.
 *
 * A Bearer token cannot be forged that way: `evil.com` cannot read a token held
 * by another origin, and `protect` prefers the Authorization header over the
 * cookie, so a request that presents a header never silently falls back to
 * ambient credentials.
 */
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5290';
const EXTRA_ORIGINS = (process.env.EXTRA_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Normalise a bare origin or a full Referer URL down to its origin. */
function normalise(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

/** Operator-controlled origins. These may use cookies. */
export function isFirstPartyOrigin(origin) {
  if (!origin) return false;
  const o = normalise(origin);
  if ([CLIENT_URL, ...EXTRA_ORIGINS].includes(o)) return true;
  const isLocalOrLan = /^https?:\/\/(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(o);
  return process.env.NODE_ENV !== 'production' && isLocalOrLan;
}

/** Tenant-registered origins. Bearer-token traffic only — never cookies. */
export function isEmbedTenantOrigin(origin) {
  if (!origin) return false;
  return isTenantOrigin(normalise(origin));
}

/**
 * Any origin we will answer at all. Used where the tier does not matter; call
 * the two functions above wherever it does — which is CORS credentials and the
 * CSRF guard.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / server-to-server / same-origin (no Origin header)
  return isFirstPartyOrigin(origin) || isEmbedTenantOrigin(origin);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense via Origin verification. On a cross-site request the browser
 * attaches an `Origin` (or at least `Referer`) that page JavaScript cannot forge
 * or suppress, so a mutation from an origin we don't trust is rejected. A missing
 * header means a non-browser client (curl, our test suites, API-key
 * integrations), which carries no ambient cookie to abuse.
 */
export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next();
  if (isFirstPartyOrigin(origin)) return next();

  if (isEmbedTenantOrigin(origin)) {
    /* Bearer-only, and only when the browser is NOT also sending our cookies.
       A cross-origin `fetch(..., {credentials:'include'})` still reaches us with
       cookies attached even when CORS later refuses to expose the response — and
       `/auth/refresh` reads that cookie without consulting any header — so the
       side effect would land. Requiring a Bearer AND the absence of auth cookies
       closes both the read and the write. Legitimate tenant traffic never has
       our cookies: it is a different site and CORS denies it credentials. */
    const hasBearer = req.headers.authorization?.startsWith('Bearer ');
    const sendsAuthCookie = Boolean(req.cookies?.token || req.cookies?.refreshToken);
    if (hasBearer && !sendsAuthCookie) return next();
    return next(
      new ApiError(
        403,
        'Embedded origins must authenticate with an Authorization: Bearer user token, not cookies.'
      )
    );
  }

  return next(new ApiError(403, 'Cross-site request blocked.'));
}

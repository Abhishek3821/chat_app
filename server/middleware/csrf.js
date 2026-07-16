import { ApiError } from '../utils/asyncHandler.js';

/**
 * Origin allowlist — the single source of truth shared by CORS (server.js) and
 * the CSRF guard below. In production only CLIENT_URL + EXTRA_CORS_ORIGINS are
 * allowed; in development any localhost/127.0.0.1/LAN origin is fine.
 */
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5290';
const EXTRA_ORIGINS = (process.env.EXTRA_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / server-to-server / same-origin (no Origin header)
  let o = origin;
  try {
    o = new URL(origin).origin; // normalise a Referer URL down to its origin
  } catch {
    /* already a bare origin */
  }
  if ([CLIENT_URL, ...EXTRA_ORIGINS].includes(o)) return true;
  const isLocalOrLan = /^https?:\/\/(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(o);
  return process.env.NODE_ENV !== 'production' && isLocalOrLan;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense via Origin verification. For any state-changing request the
 * browser attaches an `Origin` (or at least `Referer`) header that page JS
 * cannot forge or suppress on a cross-site request — so we reject mutations
 * whose origin isn't in the allowlist. A missing header means a non-browser
 * client (curl, our own tests, API-key integrations), which carries no ambient
 * session cookie to abuse, so those are allowed through.
 */
export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin || isAllowedOrigin(origin)) return next();
  return next(new ApiError(403, 'Cross-site request blocked.'));
}

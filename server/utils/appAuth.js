import crypto from 'crypto';
import App, { APP_FEATURES } from '../models/App.js';
import { asyncHandler, ApiError } from './asyncHandler.js';

/**
 * Tenant (App) authentication for the embeddable platform.
 *
 * Two distinct credentials, deliberately kept apart:
 *
 *   APP SECRET  — presented by the host product's BACKEND, over
 *                 `X-CC-App-Id` + `Authorization: Bearer <secret>`. Grants the
 *                 right to provision end users and mint user tokens for this
 *                 tenant only. Must never reach a browser.
 *   USER TOKEN  — minted from the secret, short-lived, scoped to ONE end user.
 *                 This is what a browser holds, and it is just a normal
 *                 ChatKonect access token (see mintUserSession), so every
 *                 existing protected route works with it unchanged.
 *
 * Secrets are compared as SHA-256 digests using a timing-safe comparison, and
 * looked up by digest so the plaintext never has to be read back out of Mongo.
 */

const SECRET_BYTES = 32;

export function hashAppSecret(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Mint a tenant secret. Returned ONCE; only its hash is stored. */
export function generateAppSecret() {
  const raw = `cc_sk_${crypto.randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { raw, hash: hashAppSecret(raw), prefix: raw.slice(0, 14) };
}

/** Public tenant id. Safe to embed in a frontend bundle. */
export function generateAppId() {
  return `app_${crypto.randomBytes(8).toString('hex')}`;
}

/** Constant-time digest comparison — a plain `===` on a secret digest leaks
 *  length/prefix information through timing. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Require a valid tenant secret. Populates `req.app_` (not `req.app`, which is
 * Express's own reference to the application instance — overwriting it breaks
 * `req.app.get()` and is a genuinely nasty bug to track down).
 */
export const appSecretAuth = asyncHandler(async (req, _res, next) => {
  const appId = req.headers['x-cc-app-id'];
  const raw = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.headers['x-cc-app-secret'];

  if (!appId || !raw) {
    throw new ApiError(401, 'Send X-CC-App-Id and your app secret as a Bearer token.');
  }

  const tenant = await App.findOne({ appId: String(appId) }).select('+secretHash');
  if (!tenant) throw new ApiError(401, 'Unknown app.');
  if (!tenant.active) throw new ApiError(403, 'This app is disabled.');
  if (!safeEqualHex(hashAppSecret(raw), tenant.secretHash)) throw new ApiError(401, 'Invalid app secret.');

  req.app_ = tenant;
  next();
});

/**
 * Refuse a capability the tenant hasn't been granted.
 *
 * Enforced on the SERVER on purpose: the admin console also hides disabled
 * features in the embedded UI, but hiding is not a control — a tampered client
 * could still call the endpoint, so the gate has to live here.
 */
export function requireFeature(feature) {
  if (!APP_FEATURES.includes(feature)) {
    throw new Error(`requireFeature: unknown feature "${feature}"`);
  }
  return asyncHandler(async (req, _res, next) => {
    // First-party ChatKonect users have no tenant and are not feature-gated.
    const tenant = req.app_ || (req.user?.app ? await App.findById(req.user.app) : null);
    if (!tenant) return next();
    if (!tenant.hasFeature(feature)) {
      throw new ApiError(403, `The "${feature}" feature is not enabled for this app.`);
    }
    return next();
  });
}

import rateLimit from 'express-rate-limit';
import ApiKey from '../models/ApiKey.js';
import { hashApiKey } from '../utils/apiKey.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

/**
 * Authenticate a request by its `X-API-Key` header. The key acts AS its owner
 * user (req.user), so the existing, already-secured controllers apply unchanged
 * — a key can never reach data its owner couldn't. Enforces the required scopes.
 *
 * @param {string[]} requiredScopes scopes the endpoint needs (all must be present)
 */
export const apiKeyAuth = (requiredScopes = []) =>
  asyncHandler(async (req, _res, next) => {
    const raw = req.headers['x-api-key'];
    if (!raw || typeof raw !== 'string') throw new ApiError(401, 'API key required (X-API-Key header).');

    const key = await ApiKey.findOne({ hashedKey: hashApiKey(raw), active: true })
      .select('+hashedKey')
      .populate('owner');
    if (!key || !key.owner) throw new ApiError(401, 'Invalid or revoked API key.');
    if (key.owner.accountStatus !== 'active') throw new ApiError(403, 'The key owner account is not active.');

    for (const scope of requiredScopes) {
      if (!key.scopes.includes(scope)) throw new ApiError(403, `This API key is missing the required scope: ${scope}.`);
    }

    req.apiKey = key;
    req.user = key.owner; // act on behalf of the owner
    // Best-effort "last used" stamp (don't block the request on it).
    ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() }).catch(() => {});
    next();
  });

/** Per-key rate limit for the public API (falls back to IP if no key present). */
export const apiV1Limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 requests/min per key
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : req.ip),
  message: { success: false, message: 'API rate limit exceeded (120/min). Slow down.' },
});

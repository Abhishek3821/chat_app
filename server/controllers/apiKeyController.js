import ApiKey from '../models/ApiKey.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { generateApiKey, API_SCOPES } from '../utils/apiKey.js';
import { securityEvent } from '../utils/securityLog.js';

const MAX_KEYS_PER_USER =  20;

// GET /api/keys — list my keys (never returns the secret, only the prefix).
export const listKeys = asyncHandler(async (req, res) => {
  const keys = await ApiKey.find({ owner: req.user._id }).sort({ createdAt: -1 });
  res.json({
    success: true,
    availableScopes: API_SCOPES,
    keys: keys.map((k) => ({
      id: k._id,
      label: k.label,
      prefix: k.prefix,
      scopes: k.scopes,
      active: k.active,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
});

// POST /api/keys { label, scopes } — create a key. Returns the secret ONCE.
export const createKey = asyncHandler(async (req, res) => {
  const { label = 'API key', scopes = [] } = req.body;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ApiError(400, 'Choose at least one scope.');
  }
  const bad = scopes.filter((s) => !API_SCOPES.includes(s));
  if (bad.length) throw new ApiError(400, `Unknown scope(s): ${bad.join(', ')}.`);

  const count = await ApiKey.countDocuments({ owner: req.user._id });
  if (count >= MAX_KEYS_PER_USER) throw new ApiError(429, 'API key limit reached. Revoke an old key first.');

  const { raw, hashedKey, prefix } = generateApiKey();
  const key = await ApiKey.create({
    owner: req.user._id,
    label: String(label).slice(0, 80),
    hashedKey,
    prefix,
    scopes: [...new Set(scopes)],
  });
  securityEvent('apikey.created', req, { keyId: String(key._id), scopes: key.scopes });

  res.status(201).json({
    success: true,
    message: 'Store this key now — it will not be shown again.',
    key: raw, // shown ONCE
    id: key._id,
    prefix: key.prefix,
    scopes: key.scopes,
  });
});

// DELETE /api/keys/:id — revoke one of my keys.
export const revokeKey = asyncHandler(async (req, res) => {
  const key = await ApiKey.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!key) throw new ApiError(404, 'API key not found.');
  securityEvent('apikey.revoked', req, { keyId: String(key._id) });
  res.json({ success: true, message: 'API key revoked.' });
});

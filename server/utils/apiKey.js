import crypto from 'crypto';

/** Scopes an API key can be granted. v1 endpoints require a subset of these. */
export const API_SCOPES = [
  'chat:read',
  'chat:write',
  'contacts:read',
  'calls:write',
  'meetings:read',
  'meetings:write',
];

/**
 * Mint a new API key. The plaintext is returned ONCE (to show the user); only
 * its SHA-256 hash is ever stored, so a DB leak can't reveal usable keys.
 * Format: cc_live_<url-safe-random>.
 */
export function generateApiKey() {
  const raw = `cc_live_${crypto.randomBytes(24).toString('base64url')}`;
  return { raw, hashedKey: hashApiKey(raw), prefix: raw.slice(0, 14) };
}

export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

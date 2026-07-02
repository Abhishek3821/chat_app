import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Sign a session JWT. Payload is intentionally minimal: the user id, the role,
 * and `tokenVersion`. Never the password hash or profile data. `tokenVersion`
 * lets a password change (or "log out everywhere") invalidate every
 * previously-issued token: `protect` rejects any token whose version no longer
 * matches the user's. Authorization decisions still re-read the role from the
 * database on every request, so a stale role claim can't grant access.
 */
export function signToken(user) {
  const id = typeof user === 'object' ? user._id : user;
  const role = (typeof user === 'object' && user.role) || 'user';
  const tokenVersion = typeof user === 'object' ? user.tokenVersion || 0 : 0;
  return jwt.sign({ id, role, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

/**
 * Short-lived, media-only token. Used to authorize <img>/<video> requests to
 * /uploads without ever putting the long-lived session JWT in a URL.
 */
export function signMediaToken(userId) {
  return jwt.sign({ id: String(userId), scope: 'media' }, process.env.JWT_SECRET, {
    expiresIn: '6h',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/** Sends the JWT as an httpOnly cookie AND in the JSON body (for header-based clients). */
export function sendTokenResponse(res, user, statusCode = 200, extra = {}) {
  const token = signToken(user);
  const days = Number(process.env.JWT_COOKIE_EXPIRES_DAYS || 30);
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: days * 24 * 60 * 60 * 1000,
  });
  res.status(statusCode).json({
    success: true,
    token,
    user: user.toSafeJSON ? user.toSafeJSON() : user,
    ...extra,
  });
}

/**
 * Cryptographically-secure 6-digit numeric OTP as a string.
 * `crypto.randomInt` is a CSPRNG — unlike Math.random(), its output can't be
 * predicted from prior values, which matters for an auth code.
 */
export function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Short-lived ACCESS token. Payload: user id, role, tokenVersion, and the
 * session id (`sid`) that ties it to a tracked login (see utils/session.js and
 * middleware/auth.js). Kept short — a rotating refresh token (httpOnly cookie)
 * mints new ones via POST /api/auth/refresh. Authorization decisions still
 * re-read the role from the DB on every request, so a stale role claim grants
 * nothing.
 */
const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES || '1h';

export function signAccessToken(user, sid) {
  const id = typeof user === 'object' ? user._id : user;
  const role = (typeof user === 'object' && user.role) || 'user';
  const tokenVersion = typeof user === 'object' ? user.tokenVersion || 0 : 0;
  return jwt.sign(
    { id: String(id), role, tokenVersion, sid: String(sid), type: 'access' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL }
  );
}

/**
 * Short-lived, media-only token. Used to authorize <img>/<video> requests to
 * /uploads without ever putting the long-lived session in a URL.
 */
export function signMediaToken(userId) {
  return jwt.sign({ id: String(userId), scope: 'media' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '6h',
  });
}

/**
 * Short-lived meeting-admission pass. Issued when the HOST admits a knocking
 * guest; the guest presents it on their next `meeting:join` so admission works
 * statelessly (and across instances). Scoped — it can't be used as a session.
 */
export function signMeetingPass(userId, meetingId) {
  return jwt.sign(
    { id: String(userId), meetingId: String(meetingId), scope: 'meet-admit' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

export function verifyToken(token) {
  // Pin the algorithm so a token can't be validated under an unexpected alg.
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Cookie attributes for the auth cookies. In production the frontend and API
 * usually live on different sites, where SameSite=Lax cookies are never sent —
 * cross-site needs SameSite=None+Secure. In dev (same-origin via the Vite proxy,
 * plain http) Lax is correct.
 */
export function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  };
}

/**
 * Cryptographically-secure 6-digit numeric OTP as a string. `crypto.randomInt`
 * is a CSPRNG — unlike Math.random(), its output can't be predicted from prior
 * values, which matters for an auth code.
 */
export function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

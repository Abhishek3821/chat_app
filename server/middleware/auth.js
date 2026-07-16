import { verifyToken } from '../utils/token.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { isSessionValid } from '../utils/session.js';
import { can, PERMISSIONS } from '../utils/rbac.js';

/** Requires a valid JWT (from httpOnly cookie or Authorization: Bearer header). */
export const protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) throw new ApiError(401, 'Not authenticated. Please log in.');

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Session expired or invalid. Please log in again.');
  }
  // Scoped tokens (e.g. the short-lived media token, which is designed to be
  // placed in URLs) must never work as a full API session.
  if (decoded.scope) throw new ApiError(401, 'Not authenticated. Please log in.');

  const user = await User.findById(decoded.id);
  if (!user) throw new ApiError(401, 'User no longer exists.');
  if (user.accountStatus === 'banned') throw new ApiError(403, 'This account has been banned.');
  if (user.accountStatus === 'suspended') throw new ApiError(403, 'This account is suspended.');
  // Session revocation: a password change bumps tokenVersion, invalidating every
  // token issued before it (including copies sitting in localStorage on old devices).
  if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
    throw new ApiError(401, 'Session has been revoked. Please log in again.');
  }

  // Tracked-session validation: the access token must map to a live session, so
  // logout / "log out other devices" / admin revocation take effect immediately
  // (not only when the access token happens to expire).
  if (!decoded.sid) throw new ApiError(401, 'Session expired or invalid. Please log in again.');
  const session = await Session.findById(decoded.sid).select('user revokedAt expiresAt lastActiveAt');
  if (!isSessionValid(session) || String(session.user) !== String(user._id)) {
    throw new ApiError(401, 'Session expired or revoked. Please log in again.');
  }
  // Throttled last-active bump (avoid a write on every single request).
  if (Date.now() - session.lastActiveAt.getTime() > 5 * 60 * 1000) {
    Session.updateOne({ _id: session._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
  }

  req.sessionId = String(session._id);
  req.user = user;
  next();
});

/** Requires the platform-admin permission (super-admin). Use after `protect`. */
export const adminOnly = (req, res, next) => {
  if (!can(req.user, PERMISSIONS.PLATFORM_ADMIN)) {
    return next(new ApiError(403, 'Admin access required.'));
  }
  next();
};

import { verifyToken } from '../utils/token.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import User from '../models/User.js';

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

  const user = await User.findById(decoded.id);
  if (!user) throw new ApiError(401, 'User no longer exists.');
  if (user.accountStatus === 'banned') throw new ApiError(403, 'This account has been banned.');
  if (user.accountStatus === 'suspended') throw new ApiError(403, 'This account is suspended.');
  // Session revocation: a password change bumps tokenVersion, invalidating every
  // token issued before it (including copies sitting in localStorage on old devices).
  if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
    throw new ApiError(401, 'Session has been revoked. Please log in again.');
  }

  req.user = user;
  next();
});

/** Requires an admin role. Use after `protect`. */
export const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return next(new ApiError(403, 'Admin access required.'));
  }
  next();
};

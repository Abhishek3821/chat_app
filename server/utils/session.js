import crypto from 'crypto';
import Session from '../models/Session.js';
import { signAccessToken, sessionCookieOptions } from './token.js';

// Absolute session lifetime, and the idle window after which an untouched
// session is treated as expired. Both tunable via env.
const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS || 14);
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_COOKIE_MS = 60 * 60 * 1000; // mirrors the access token TTL

export const hashToken = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const genRefreshToken = () => crypto.randomBytes(32).toString('hex');

/** Best-effort human label for a session, from the User-Agent (no external dep). */
export function parseDevice(ua = '') {
  const s = String(ua);
  const os =
    /Windows/i.test(s) ? 'Windows' :
    /Android/i.test(s) ? 'Android' :
    /iPhone|iPad|iOS/i.test(s) ? 'iOS' :
    /Mac OS X|Macintosh/i.test(s) ? 'macOS' :
    /Linux/i.test(s) ? 'Linux' : '';
  const browser =
    /Edg\//i.test(s) ? 'Edge' :
    /Chrome\//i.test(s) && !/Chromium/i.test(s) ? 'Chrome' :
    /Firefox\//i.test(s) ? 'Firefox' :
    /Safari\//i.test(s) && !/Chrome/i.test(s) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Unknown device';
}

/** Create a fresh session for a login. Returns the session + the plaintext refresh token. */
export async function createSession(user, req) {
  const refreshToken = genRefreshToken();
  const now = Date.now();
  const session = await Session.create({
    user: user._id,
    refreshHash: hashToken(refreshToken),
    device: parseDevice(req?.get?.('user-agent')),
    userAgent: (req?.get?.('user-agent') || '').slice(0, 300),
    ip: req?.ip || '',
    lastActiveAt: new Date(now),
    expiresAt: new Date(now + REFRESH_DAYS * DAY_MS),
  });
  return { session, refreshToken };
}

/** Rotate a session's refresh token (invalidates the previous one). */
export async function rotateSession(session, req) {
  const refreshToken = genRefreshToken();
  session.refreshHash = hashToken(refreshToken);
  session.lastActiveAt = new Date();
  if (req?.ip) session.ip = req.ip;
  await session.save();
  return refreshToken;
}

/** A session is usable only if not revoked, within its absolute expiry, and not idle-expired. */
export function isSessionValid(session) {
  if (!session || session.revokedAt) return false;
  const now = Date.now();
  if (session.expiresAt && session.expiresAt.getTime() < now) return false;
  if (session.lastActiveAt && now - session.lastActiveAt.getTime() > IDLE_DAYS * DAY_MS) return false;
  return true;
}

export function refreshCookieOptions() {
  // Scope the refresh cookie to the auth routes so it isn't sent on every request.
  return { ...sessionCookieOptions(), path: '/api/auth', maxAge: REFRESH_DAYS * DAY_MS };
}

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('token', accessToken, { ...sessionCookieOptions(), maxAge: ACCESS_COOKIE_MS });
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
}

export function clearAuthCookies(res) {
  res.cookie('token', '', { ...sessionCookieOptions(), expires: new Date(0) });
  res.cookie('refreshToken', '', { ...refreshCookieOptions(), expires: new Date(0) });
}

/**
 * Establish a login: create a session, mint an access token bound to it, set the
 * auth cookies, and return the standard auth JSON (also carries the access token
 * in the body for header-based clients). Replaces the old stateless helper.
 */
export async function sendTokenResponse(req, res, user, statusCode = 200, extra = {}) {
  const { session, refreshToken } = await createSession(user, req);
  const accessToken = signAccessToken(user, session._id);
  setAuthCookies(res, accessToken, refreshToken);
  res.status(statusCode).json({
    success: true,
    token: accessToken,
    user: user.toSafeJSON ? user.toSafeJSON() : user,
    ...extra,
  });
}

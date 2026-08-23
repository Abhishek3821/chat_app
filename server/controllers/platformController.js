import crypto from 'crypto';
import { refreshTenantOrigins } from '../utils/tenantOrigins.js';
import User from '../models/User.js';
import App, { APP_FEATURES } from '../models/App.js';
import Session from '../models/Session.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { signAccessToken } from '../utils/token.js';
import { createSession } from '../utils/session.js';
import { generateAppId, generateAppSecret } from '../utils/appAuth.js';

/**
 * The platform API a host product's BACKEND talks to (app-secret authenticated).
 *
 * Integration shape, which is the whole point of this file:
 *   1. host backend: POST /v1/platform/users   → upsert their user here
 *   2. host backend: POST /v1/platform/tokens  → short-lived token for that user
 *   3. host frontend: hand that token to the SDK / widget
 *
 * The browser therefore only ever holds a token scoped to ONE end user, and the
 * secret that could mint tokens for anyone stays on the host's server.
 */

/** Digits/letters only, so a host's arbitrary id can seed a valid username. */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);

/**
 * Build globally-unique, non-guessable credentials for a tenant end user.
 *
 * Tenant users never log in with a password — they arrive via token exchange —
 * but `email`, `username` and `password` are all required and globally unique on
 * the User schema. Rather than migrate those indexes to be tenant-scoped (a
 * risky rebuild on a live collection), the values are DERIVED from the tenant +
 * external id, which makes them unique by construction.
 *
 * `.invalid` is the RFC 2606 reserved TLD: these addresses are guaranteed never
 * to route, so a stray notification can't email a real stranger.
 */
function synthesizeIdentity(tenant, externalId) {
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${tenant.appId}:${externalId}`)
    .digest('hex')
    .slice(0, 12);
  /* User.username is capped at 30 characters, and the tenant prefix alone is 19
     ("app" + 16 hex). The previous layout appended the full externalId slug, so
     anything longer than five characters overflowed and provisioning died on a
     raw Mongoose validation error — which is every realistic externalId.

     Budget, worst case 26 of the 30 available:
       appPart  8   readable hint of which tenant a row belongs to
       extPart  6   readable hint of which end user
       fp      10   40 bits, the part that actually has to be unique
       2 separators

     The authoritative identifier is the indexed `externalId` field; this string
     only has to be unique and vaguely recognisable, so the readable halves are
     the ones that get truncated. */
  const appPart = slug(tenant.appId).slice(0, 8);
  const extPart = slug(externalId).slice(0, 6) || fingerprint.slice(0, 6);
  const username = `${appPart}_${extPart}_${fingerprint.slice(0, 10)}`.slice(0, 30);

  return {
    email: `u-${fingerprint}@${tenant.appId}.app.invalid`,
    username,
    password: crypto.randomBytes(24).toString('base64url'), // unusable by design
  };
}

const publicUser = (u) => ({
  id: u._id,
  externalId: u.externalId,
  name: u.name,
  avatar: u.avatar,
  bio: u.bio,
  createdAt: u.createdAt,
});

/**
 * POST /v1/platform/users — idempotent upsert of one of the host's users.
 * Called again with the same externalId, it updates the profile instead of
 * creating a second account (see the partial unique index on app+externalId).
 */
export const upsertAppUser = asyncHandler(async (req, res) => {
  const tenant = req.app_;
  const { externalId, name, avatar, bio } = req.body;
  if (!externalId || typeof externalId !== 'string' || externalId.length > 128) {
    throw new ApiError(400, 'externalId is required (a string, up to 128 characters).');
  }
  if (!name || typeof name !== 'string') throw new ApiError(400, 'name is required.');

  const existing = await User.findOne({ app: tenant._id, externalId });
  if (existing) {
    existing.name = name.slice(0, 60);
    if (avatar !== undefined) existing.avatar = String(avatar).slice(0, 500);
    if (bio !== undefined) existing.bio = String(bio).slice(0, 160);
    await existing.save({ validateBeforeSave: false });
    return res.json({ success: true, created: false, user: publicUser(existing) });
  }

  // Seat cap, so one tenant can't quietly consume the whole platform.
  const seats = await User.countDocuments({ app: tenant._id });
  if (seats >= (tenant.limits?.maxUsers ?? 10_000)) {
    throw new ApiError(429, 'This app has reached its provisioned-user limit.');
  }

  const identity = synthesizeIdentity(tenant, externalId);
  const user = await User.create({
    app: tenant._id,
    externalId,
    name: name.slice(0, 60),
    avatar: avatar ? String(avatar).slice(0, 500) : '',
    ...(bio ? { bio: String(bio).slice(0, 160) } : {}),
    ...identity,
    isVerified: true, // provisioned by a trusted backend; no email to confirm
  });

  await App.updateOne({ _id: tenant._id }, { $inc: { 'usage.users': 1 }, $set: { 'usage.lastActivityAt': new Date() } });
  return res.status(201).json({ success: true, created: true, user: publicUser(user) });
});

/**
 * POST /v1/platform/tokens — mint a short-lived token for one end user.
 *
 * Deliberately issues a REAL tracked session + access token, the same pair a
 * first-party login produces. That means every existing protected route and the
 * socket handshake accept it with no special-casing, and revocation
 * ("log out this user") works through the machinery that already exists. The
 * only difference is the lifetime, which comes from the tenant's limits.
 */
export const issueUserToken = asyncHandler(async (req, res) => {
  const tenant = req.app_;
  const { externalId } = req.body;
  if (!externalId) throw new ApiError(400, 'externalId is required.');

  const user = await User.findOne({ app: tenant._id, externalId });
  if (!user) throw new ApiError(404, 'No such user for this app. Provision them first.');
  if (user.accountStatus !== 'active') throw new ApiError(403, 'This user is not active.');

  const minutes = Math.min(Math.max(Number(tenant.limits?.userTokenMinutes) || 60, 5), 24 * 60);
  // createSession issues the standard 30-day refresh session. We keep the ROW
  // (that's what makes `protect` and revocation work unchanged) but pull its
  // expiry in to the tenant's window, and never hand the refresh token to
  // anyone — the host re-mints through this endpoint instead. So a leaked
  // end-user token dies in minutes rather than lasting a month.
  const { session } = await createSession(user, req);
  await Session.updateOne(
    { _id: session._id },
    { $set: { expiresAt: new Date(Date.now() + minutes * 60 * 1000), userAgent: `app:${tenant.appId}` } }
  );
  const token = signAccessToken(user, session._id, { expiresIn: `${minutes}m` });

  await App.updateOne(
    { _id: tenant._id },
    { $inc: { 'usage.tokensIssued': 1 }, $set: { 'usage.lastActivityAt': new Date() } }
  );

  res.json({
    success: true,
    token,
    expiresInSeconds: minutes * 60,
    user: publicUser(user),
    // Echoed so the SDK can hide surfaces the tenant hasn't bought without a
    // second round trip. The server still enforces them (requireFeature).
    features: tenant.features,
  });
});

/* ───────────────────────── Admin-side (dashboard) ─────────────────────────
   These are session-authenticated (`protect`), not app-secret authenticated —
   they're what the ChatKonect admin console uses to create and manage tenants.
   A caller only ever sees the apps they own; platform admins see all of them. */

const adminScope = (user) => (user.role === 'admin' ? {} : { owner: user._id });

/** GET /api/apps — tenants visible to the caller. */
export const listApps = asyncHandler(async (req, res) => {
  const apps = await App.find(adminScope(req.user)).sort({ createdAt: -1 }).lean();
  res.json({ success: true, apps });
});

/**
 * POST /api/apps — create a tenant.
 * The secret is returned exactly ONCE here; only its hash is stored, so a lost
 * secret must be rotated rather than recovered.
 */
export const createApp = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'An app name is required.');

  const secret = generateAppSecret();
  const app = await App.create({
    name: name.slice(0, 80),
    appId: generateAppId(),
    secretHash: secret.hash,
    secretPrefix: secret.prefix,
    owner: req.user._id,
    ...(Array.isArray(req.body.features) ? { features: req.body.features } : {}),
  });

  res.status(201).json({
    success: true,
    app: { ...app.toObject(), secretHash: undefined },
    secret: secret.raw, // shown once
  });
});

/** PATCH /api/apps/:id — rename, toggle features/limits/origins, enable/disable. */
export const updateApp = asyncHandler(async (req, res) => {
  const app = await App.findOne({ _id: req.params.id, ...adminScope(req.user) });
  if (!app) throw new ApiError(404, 'App not found.');

  if (req.body.name !== undefined) app.name = String(req.body.name).trim().slice(0, 80);
  if (req.body.active !== undefined) app.active = Boolean(req.body.active);
  if (req.body.features !== undefined) {
    if (!Array.isArray(req.body.features)) throw new ApiError(400, 'features must be a list.');
    const unknown = req.body.features.filter((f) => !APP_FEATURES.includes(f));
    if (unknown.length) throw new ApiError(400, `Unknown feature(s): ${unknown.join(', ')}`);
    app.features = req.body.features;
  }
  if (req.body.allowedOrigins !== undefined) {
    if (!Array.isArray(req.body.allowedOrigins)) throw new ApiError(400, 'allowedOrigins must be a list.');
    /* Must be real http(s) origins. "null" (what a sandboxed iframe, a file://
       page and some redirect chains send), "*", and scheme-only junk are all
       rejected — an origin allowlist that accepts non-origins silently grants
       far more than the console suggests. Normalised so that a trailing slash
       or a full URL with a path cannot cause a same-origin value to miss. */
    const normalised = [];
    for (const raw of req.body.allowedOrigins.slice(0, 20)) {
      const value = String(raw).trim().slice(0, 200);
      if (!value) continue;
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new ApiError(400, `"${value}" is not a valid origin. Use the full form, e.g. https://app.example.com.`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ApiError(400, `"${value}" must use http:// or https://.`);
      }
      if (!normalised.includes(parsed.origin)) normalised.push(parsed.origin);
    }
    app.allowedOrigins = normalised;
  }
  if (req.body.limits?.maxUsers !== undefined) {
    app.limits.maxUsers = Math.max(1, Math.min(Number(req.body.limits.maxUsers) || 1, 1_000_000));
  }
  if (req.body.limits?.userTokenMinutes !== undefined) {
    app.limits.userTokenMinutes = Math.max(5, Math.min(Number(req.body.limits.userTokenMinutes) || 60, 1440));
  }

  await app.save();
  await refreshTenantOrigins(); // origins/active feed the CORS allowlist — awaited so the next request sees it
  res.json({ success: true, app: { ...app.toObject(), secretHash: undefined } });
});

/** POST /api/apps/:id/rotate — mint a new secret and invalidate the old one. */
export const rotateAppSecret = asyncHandler(async (req, res) => {
  const app = await App.findOne({ _id: req.params.id, ...adminScope(req.user) });
  if (!app) throw new ApiError(404, 'App not found.');
  const secret = generateAppSecret();
  app.secretHash = secret.hash;
  app.secretPrefix = secret.prefix;
  app.secretRotatedAt = new Date();
  await app.save();
  await refreshTenantOrigins(); // origins/active feed the CORS allowlist — awaited so the next request sees it
  res.json({ success: true, secret: secret.raw, secretPrefix: secret.prefix });
});

/** DELETE /api/apps/:id — disable a tenant.
 *  Soft: flipping `active` immediately stops token minting and every request
 *  from its users, without orphaning the conversations they've already had. */
export const disableApp = asyncHandler(async (req, res) => {
  const app = await App.findOne({ _id: req.params.id, ...adminScope(req.user) });
  if (!app) throw new ApiError(404, 'App not found.');
  app.active = false;
  await app.save();
  await refreshTenantOrigins(); // origins/active feed the CORS allowlist — awaited so the next request sees it
  res.json({ success: true, disabled: true });
});

/** GET /api/apps/:id/stats — live counts for the console (users are counted
 *  here rather than trusted from the cached counter). */
export const appStats = asyncHandler(async (req, res) => {
  const app = await App.findOne({ _id: req.params.id, ...adminScope(req.user) });
  if (!app) throw new ApiError(404, 'App not found.');
  const [users, active] = await Promise.all([
    User.countDocuments({ app: app._id }),
    User.countDocuments({ app: app._id, accountStatus: 'active' }),
  ]);
  res.json({
    success: true,
    stats: {
      users,
      activeUsers: active,
      tokensIssued: app.usage?.tokensIssued || 0,
      lastActivityAt: app.usage?.lastActivityAt || null,
      features: app.features,
      seatLimit: app.limits?.maxUsers,
    },
  });
});

/** GET /v1/platform/users — page through this tenant's provisioned users. */
export const listAppUsers = asyncHandler(async (req, res) => {
  const tenant = req.app_;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const users = await User.find({ app: tenant._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('externalId name avatar bio createdAt')
    .lean();
  res.json({ success: true, count: users.length, users: users.map((u) => ({ ...u, id: u._id })) });
});

/**
 * DELETE /v1/platform/users/:externalId — revoke access for one end user.
 *
 * Suspends rather than deletes. Removing the account would orphan every message
 * they ever sent in the tenant's conversations, which is destructive and almost
 * never what "remove this user from my app" is meant to mean. Suspension makes
 * `protect` reject them immediately, including any token already issued.
 */
export const deactivateAppUser = asyncHandler(async (req, res) => {
  const tenant = req.app_;
  const user = await User.findOne({ app: tenant._id, externalId: req.params.externalId });
  if (!user) throw new ApiError(404, 'No such user for this app.');
  user.accountStatus = 'suspended';
  user.tokenVersion = (user.tokenVersion || 0) + 1; // kills tokens already out there
  await user.save({ validateBeforeSave: false });
  res.json({ success: true, deactivated: true, externalId: user.externalId });
});

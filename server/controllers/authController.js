import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import EmailVerification from '../models/EmailVerification.js';
import Workspace from '../models/Workspace.js';
import Session from '../models/Session.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { signAccessToken, generateOTP } from '../utils/token.js';
import { sendTokenResponse, setAuthCookies, clearAuthCookies, rotateSession, isSessionValid, hashToken } from '../utils/session.js';
import { sendEmail, otpEmailTemplate, isEmailConfigured } from '../utils/sendEmail.js';
import { normalizePhone } from '../utils/sendSms.js';
import { createWorkspaceForUser, joinWorkspaceByCode, joinPersonalSpace } from '../utils/workspaceService.js';
import { securityEvent } from '../utils/securityLog.js';

const EMAIL_VERIFY_ON = process.env.ENABLE_EMAIL_VERIFICATION === 'true';

/** Coerce untrusted input to a normalized email string ('' if not a string). */
const cleanEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * Optional signup avatar: a small base64 data-URL image (the client downscales
 * before sending) or an https URL. Anything else is silently ignored — the
 * account still gets a generated avatar, signup never fails over a photo.
 */
function safeAvatar(v) {
  if (typeof v !== 'string' || !v) return null;
  if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 400_000) return v;
  if (/^https:\/\/\S+$/.test(v) && v.length <= 2048) return v;
  return null;
}

/** Derive a unique username from the email local part (signup no longer asks for one). */
async function generateUsername(email, explicit) {
  if (typeof explicit === 'string' && /^[a-z0-9_.]{3,30}$/.test(explicit.toLowerCase())) {
    return explicit.toLowerCase(); // legacy clients may still send one
  }
  const base =
    cleanEmail(email)
      .split('@')[0]
      .replace(/[^a-z0-9_.]/g, '')
      .slice(0, 24) || 'user';
  const padded = base.length >= 3 ? base : `${base}user`.slice(0, 6);
  let candidate = padded;
  // Suffix with random digits until free (bounded — collisions are rare).
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const taken = await User.exists({ username: candidate });
    if (!taken) return candidate;
    candidate = `${padded.slice(0, 24)}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return `${padded.slice(0, 18)}${Date.now().toString(36)}`;
}

/** Short-lived proof that THIS email's inbox was just verified (pre-signup). */
const EMAIL_PROOF_TTL = '30m';
function signEmailProof(email) {
  return jwt.sign({ email, purpose: 'signup-email' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: EMAIL_PROOF_TTL,
  });
}
function emailProofValid(token, email) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return p.purpose === 'signup-email' && p.email === email;
  } catch {
    return false;
  }
}

// POST /api/auth/email/send-code  { email }
// Step 1 of signup: send a verification code to the address BEFORE any account
// exists. The Verify button on the signup form calls this.
export const sendSignupEmailCode = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please provide a valid email address.');
  if (await User.exists({ email })) throw new ApiError(409, 'An account with that email already exists.');

  const otp = generateOTP();
  await EmailVerification.findOneAndUpdate(
    { email },
    { otp, expires: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, verifiedAt: null },
    { upsert: true, new: true }
  );

  const emailConfigured = isEmailConfigured();
  let sent = false;
  try {
    const r = await sendEmail({
      to: email,
      subject: 'Verify your email for ChatConnect',
      html: otpEmailTemplate('there', otp),
      text: `Your ChatConnect verification code is ${otp}. It expires in 10 minutes.`,
    });
    sent = !!r?.sent;
  } catch (err) {
    console.error('❌ Signup email code failed:', err.message);
  }
  // SMTP is set up but the send failed → surface a real error, not a fake success.
  if (emailConfigured && !sent) {
    throw new ApiError(502, 'We could not send the verification email right now. Please try again in a moment.');
  }
  securityEvent('signup.email.code', req, { email });
  res.json({
    success: true,
    message: sent
      ? `We sent a verification code to ${email}.`
      : 'Email is not configured — the code is shown below (development only).',
    // Dev convenience only: surface the OTP when SMTP isn't set up.
    ...(!emailConfigured && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

// POST /api/auth/email/verify-code  { email, otp } → { emailToken }
// Step 2 of signup: check the code; on success return a short-lived signed
// proof the client must include in the final signup request.
export const verifySignupEmailCode = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const rec = await EmailVerification.findOne({ email }).select('+otp');
  if (!rec || !rec.otp) throw new ApiError(400, 'No code was requested for that email. Click Verify first.');
  if ((rec.attempts || 0) >= 5) {
    securityEvent('signup.email.locked', req, { email });
    throw new ApiError(429, 'Too many incorrect attempts. Request a new code.');
  }
  if (String(rec.otp) !== String(req.body.otp || '')) {
    rec.attempts = (rec.attempts || 0) + 1;
    await rec.save();
    securityEvent('signup.email.failure', req, { email });
    throw new ApiError(400, 'Invalid verification code.');
  }
  if (rec.expires < Date.now()) throw new ApiError(400, 'That code has expired. Request a new one.');

  rec.verifiedAt = new Date();
  rec.otp = undefined;
  await rec.save();
  securityEvent('signup.email.verified', req, { email });
  res.json({ success: true, verified: true, emailToken: signEmailProof(email) });
});

// POST /api/auth/signup
export const signup = asyncHandler(async (req, res) => {
  // SECURITY: pick ONLY the fields a new account may set. `role`, `isAdmin`,
  // `admin`, `accountStatus`, `isVerified`, … from the request body are never
  // read — signup can only ever create a regular user.
  const { name, email, password } = req.body;
  if ([name, email, password].some((v) => typeof v !== 'string' || !v)) {
    throw new ApiError(400, 'Name, email and password are required.');
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    throw new ApiError(400, 'Please provide a valid email address.');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }
  if (typeof req.body.confirmPassword === 'string' && req.body.confirmPassword !== password) {
    throw new ApiError(400, 'Passwords do not match.');
  }

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw new ApiError(409, 'An account with that email already exists.');

  // Phone number is REQUIRED and must be unique — one number = one account.
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw new ApiError(400, 'Please provide a valid phone number (7–15 digits, e.g. +919876543210).');
  const phoneTaken = await User.findOne({ phone });
  if (phoneTaken) throw new ApiError(409, 'That phone number is already linked to another account.');

  // The email must be verified BEFORE the account is created: the client's
  // Verify button (send-code → verify-code) yields a short-lived signed proof.
  // Without it, signup fails — no unverified accounts exist at all.
  if (EMAIL_VERIFY_ON && !emailProofValid(req.body.emailToken, email.trim().toLowerCase())) {
    throw new ApiError(400, 'Please verify your email address before signing up.');
  }

  // Multi-tenant: an optional invite code makes the user JOIN that workspace;
  // otherwise the account type decides — 'personal' joins the shared Personal
  // space; 'workspace' (default) creates their own company workspace. Validate
  // the code BEFORE creating the account so a bad code fails cleanly.
  const inviteCode =
    (typeof req.body.inviteCode === 'string' && req.body.inviteCode.trim()) ||
    (typeof req.body.invite === 'string' && req.body.invite.trim()) ||
    '';
  if (inviteCode && !(await Workspace.exists({ inviteCode }))) {
    throw new ApiError(400, 'That invite code is invalid or has expired.');
  }
  // An invite always means a workspace join. Otherwise honour the chosen type,
  // DEFAULTING to 'personal': a client that never sends accountType (older
  // clients, API consumers, tests) must not end up alone in a private workspace
  // where they can never contact anyone. Company workspaces are explicit opt-in.
  const accountType = inviteCode || req.body.accountType === 'workspace' ? 'workspace' : 'personal';

  const baseDoc = {
    name: name.trim().slice(0, 60),
    email,
    phone,
    password, // hashed by the User pre-save hook (bcrypt, cost 12)
    role: 'user', // ALWAYS user — admins are created only via seed/manual promotion
    isVerified: true, // email was proven above (or verification is disabled)
  };

  let user;
  // Retry on the (rare) username unique-index race between two simultaneous signups.
  for (let attempt = 0; ; attempt += 1) {
    const username = await generateUsername(email, attempt === 0 ? req.body.username : undefined);
    try {
      user = await User.create({
        ...baseDoc,
        username,
        avatar: safeAvatar(req.body.avatar) || `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(username)}`,
      });
      break;
    } catch (err) {
      if (err?.code === 11000 && err.keyValue?.username && attempt < 2) continue;
      throw err;
    }
  }

  // Attach the account: join by invite, join the shared Personal space, or
  // create a new company workspace.
  if (inviteCode) await joinWorkspaceByCode(user, inviteCode);
  else if (accountType === 'personal') await joinPersonalSpace(user);
  else await createWorkspaceForUser(user, req.body.workspaceName);

  // The verification record has served its purpose.
  EmailVerification.deleteOne({ email: email.trim().toLowerCase() }).catch(() => {});

  securityEvent('signup.success', req, { userId: String(user._id) });
  await sendTokenResponse(req, res, user, 201);
});

// POST /api/auth/verify-otp
export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email: cleanEmail(email) }).select('+otp +otpExpires +otpAttempts');
  if (!user) throw new ApiError(404, 'No account found for that email.');
  // SECURITY: never mint a session on the "already verified" branch — that would
  // let anyone log in as any account knowing only the email. Require normal login.
  if (user.isVerified) throw new ApiError(400, 'Account is already verified. Please log in.');

  // Lockout: the OTP space is only 1e6, so cap wrong guesses per code to stop
  // brute force even within the auth rate-limit window. Reset by requesting a new code.
  if ((user.otpAttempts || 0) >= 5) {
    securityEvent('otp.verify.locked', req, { email: user.email });
    throw new ApiError(429, 'Too many incorrect attempts. Request a new code.');
  }

  if (!user.otp || String(user.otp) !== String(otp)) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await user.save({ validateBeforeSave: false });
    securityEvent('otp.verify.failure', req, { email: user.email });
    throw new ApiError(400, 'Invalid verification code.');
  }
  if (user.otpExpires < Date.now()) throw new ApiError(400, 'Verification code has expired.');

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  user.otpAttempts = 0;
  await user.save();
  securityEvent('otp.verify.success', req, { userId: String(user._id) });
  await sendTokenResponse(req, res, user);
});

// POST /api/auth/resend-otp
export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: cleanEmail(email) }).select('+otp +otpExpires');
  if (!user) throw new ApiError(404, 'No account found for that email.');
  if (user.isVerified) throw new ApiError(400, 'Account is already verified.');

  const otp = generateOTP();
  user.otp = otp;
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.otpAttempts = 0; // fresh code → reset the lockout counter
  await user.save();
  const emailConfigured = isEmailConfigured();
  try {
    await sendEmail({
      to: user.email,
      subject: 'Your new ChatConnect code',
      html: otpEmailTemplate(user.name, otp),
      text: `Your ChatConnect verification code is ${otp}`,
    });
  } catch (err) {
    console.error('❌ OTP resend email failed:', err.message);
  }
  res.json({
    success: true,
    message: 'A new code has been sent.',
    ...(!emailConfigured && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

/**
 * Resolve a login identifier — email, username, or phone number — to a query.
 * The same free-text box accepts all three (WhatsApp-style).
 */
function identifierQuery(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const or = [];
  if (id.includes('@')) or.push({ email: id.toLowerCase() });
  const phone = normalizePhone(id);
  if (phone) or.push({ phone });
  if (/^[a-z0-9_.]{3,30}$/i.test(id)) or.push({ username: id.toLowerCase() });
  return or.length ? { $or: or } : null;
}

/** Shared credential check for login. Throws on any failure. */
async function checkCredentials(req, identifier, password) {
  const query = identifierQuery(identifier);
  if (!query || typeof password !== 'string' || !password) {
    throw new ApiError(400, 'Enter your email, username or phone number, and your password.');
  }
  const user = await User.findOne(query).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    securityEvent('login.failure', req, { identifier: String(identifier).slice(0, 60) });
    throw new ApiError(401, 'Invalid credentials. Check your details and try again.');
  }
  if (EMAIL_VERIFY_ON && !user.isVerified) {
    throw new ApiError(403, 'Please verify your email before logging in.');
  }
  if (user.accountStatus !== 'active') {
    throw new ApiError(403, `Your account is ${user.accountStatus}.`);
  }
  return user;
}

// POST /api/auth/login  { identifier | email, password }
// Single-step sign-in: email/username/phone + password → session. The email
// must already be verified (checkCredentials rejects unverified accounts).
export const login = asyncHandler(async (req, res) => {
  const identifier = req.body.identifier ?? req.body.email; // legacy clients send `email`
  const user = await checkCredentials(req, identifier, req.body.password);
  user.isOnline = true;
  user.lastSeen = new Date();
  await user.save({ validateBeforeSave: false });
  securityEvent('login.success', req, { userId: String(user._id) });
  return sendTokenResponse(req, res, user);
});

// POST /api/auth/logout — revoke THIS session (not just clear the cookie).
export const logout = asyncHandler(async (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (raw) await Session.updateOne({ refreshHash: hashToken(raw) }, { $set: { revokedAt: new Date() } });
  else if (req.sessionId) await Session.updateOne({ _id: req.sessionId }, { $set: { revokedAt: new Date() } });
  clearAuthCookies(res);
  if (req.user) {
    req.user.isOnline = false;
    req.user.lastSeen = new Date();
    await req.user.save({ validateBeforeSave: false });
  }
  res.json({ success: true, message: 'Logged out.' });
});

// POST /api/auth/refresh — rotate the refresh token and mint a fresh access
// token. Authenticated by the httpOnly refresh cookie (the access token may have
// already expired), so this route is deliberately NOT behind `protect`.
export const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (!raw) throw new ApiError(401, 'No refresh token.');
  const session = await Session.findOne({ refreshHash: hashToken(raw) }).select('+refreshHash user revokedAt expiresAt lastActiveAt');
  if (!isSessionValid(session)) {
    clearAuthCookies(res);
    throw new ApiError(401, 'Session expired. Please log in again.');
  }
  const user = await User.findById(session.user);
  if (!user || user.accountStatus !== 'active') {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
    clearAuthCookies(res);
    throw new ApiError(401, 'Account is not active.');
  }
  const refreshToken = await rotateSession(session, req);
  const accessToken = signAccessToken(user, session._id);
  setAuthCookies(res, accessToken, refreshToken);
  res.json({ success: true, token: accessToken, user: user.toSafeJSON() });
});

// GET /api/auth/sessions — the caller's active devices/sessions.
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastActiveAt: -1 });
  res.json({
    success: true,
    sessions: sessions.map((s) => ({
      id: String(s._id),
      device: s.device,
      ip: s.ip,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
      current: String(s._id) === String(req.sessionId),
    })),
  });
});

// DELETE /api/auth/sessions/:id — revoke one session (log out that device).
export const revokeSession = asyncHandler(async (req, res) => {
  await Session.updateOne({ _id: req.params.id, user: req.user._id }, { $set: { revokedAt: new Date() } });
  res.json({ success: true });
});

// POST /api/auth/sessions/revoke-others — log out every device except this one.
export const revokeOtherSessions = asyncHandler(async (req, res) => {
  await Session.updateMany(
    { user: req.user._id, _id: { $ne: req.sessionId }, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  res.json({ success: true });
});

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeJSON() });
});

// POST /api/auth/forgot-password
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: cleanEmail(email) });
  // Always respond success to avoid leaking which emails exist.
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your ChatConnect password',
        html: `<p>Reset your password using the link below (valid 30 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        text: `Reset your password: ${resetUrl}`,
      });
    } catch (err) {
      console.error('❌ Password-reset email failed:', err.message);
    }
  }
  res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req, res) => {
  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpires');
  if (!user) throw new ApiError(400, 'Reset link is invalid or has expired.');

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // revoke all old sessions
  await user.save();
  // Kill every tracked session too, then start a fresh one for this device.
  await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  securityEvent('password.reset', req, { userId: String(user._id) });
  await sendTokenResponse(req, res, user);
});

// PATCH /api/auth/change-password
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(currentPassword))) {
    securityEvent('password.change.failure', req, { userId: String(user._id) });
    throw new ApiError(401, 'Current password is incorrect.');
  }
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // revoke all old sessions
  await user.save();
  // Log out every device on a password change, then re-issue for THIS one.
  await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  securityEvent('password.change', req, { userId: String(user._id) });
  await sendTokenResponse(req, res, user, 200, { message: 'Password updated.' });
});

// ── Two-step verification (app-lock PIN) ─────────────────────────
// A 4–8 digit PIN required to open ChatConnect on a device, stored bcrypt-hashed.

// POST /api/auth/two-step/enable  { pin }
export const enableTwoStep = asyncHandler(async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) throw new ApiError(400, 'Your PIN must be 4 to 8 digits.');
  const user = await User.findById(req.user._id).select('+twoStepPin');
  // Never silently overwrite an existing PIN — changing it requires proving
  // knowledge of the current one (see changeTwoStepPin).
  if (user.twoStepEnabled) throw new ApiError(400, 'Two-step is already on. Use "change PIN" instead.');
  user.twoStepPin = await bcrypt.hash(pin, 10);
  user.twoStepEnabled = true;
  await user.save();
  securityEvent('twostep.enable', req, { userId: String(user._id) });
  res.json({ success: true, twoStepEnabled: true });
});

// POST /api/auth/two-step/change  { currentPin, newPin } — rotate the PIN.
// The current PIN must match before the new one is accepted (rate-limited).
export const changeTwoStepPin = asyncHandler(async (req, res) => {
  const currentPin = String(req.body.currentPin || '');
  const newPin = String(req.body.newPin || '');
  if (!/^\d{4,8}$/.test(newPin)) throw new ApiError(400, 'Your new PIN must be 4 to 8 digits.');
  const user = await User.findById(req.user._id).select('+twoStepPin');
  if (!user.twoStepEnabled) throw new ApiError(400, 'Two-step verification is not enabled.');
  const ok = user.twoStepPin && (await bcrypt.compare(currentPin, user.twoStepPin));
  if (!ok) {
    securityEvent('twostep.change.failure', req, { userId: String(user._id) });
    throw new ApiError(400, 'Your current PIN is incorrect.');
  }
  if (currentPin === newPin) throw new ApiError(400, 'The new PIN must be different from the current one.');
  user.twoStepPin = await bcrypt.hash(newPin, 10);
  await user.save();
  securityEvent('twostep.change', req, { userId: String(user._id) });
  res.json({ success: true, twoStepEnabled: true });
});

// POST /api/auth/two-step/disable  { pin }
export const disableTwoStep = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoStepPin');
  if (user.twoStepEnabled) {
    const ok = user.twoStepPin && (await bcrypt.compare(String(req.body.pin || ''), user.twoStepPin));
    if (!ok) throw new ApiError(400, 'Incorrect PIN.');
  }
  user.twoStepEnabled = false;
  user.twoStepPin = undefined;
  await user.save();
  securityEvent('twostep.disable', req, { userId: String(user._id) });
  res.json({ success: true, twoStepEnabled: false });
});

// POST /api/auth/two-step/verify  { pin }  — unlock this session (rate-limited).
export const verifyTwoStep = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoStepPin');
  if (!user.twoStepEnabled) return res.json({ success: true, verified: true });
  const ok = user.twoStepPin && (await bcrypt.compare(String(req.body.pin || ''), user.twoStepPin));
  if (!ok) {
    securityEvent('twostep.verify.failure', req, { userId: String(user._id) });
    throw new ApiError(400, 'Incorrect PIN.');
  }
  res.json({ success: true, verified: true });
});

// POST /api/auth/two-step/forgot — email an OTP that lets the user reset a
// forgotten app-lock / chat-lock PIN. The requester is already authenticated
// (the lock screen sits BEHIND login), so the OTP simply proves email ownership.
export const requestTwoStepReset = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoStepResetOtp +twoStepResetExpires');
  if (!user.twoStepEnabled) throw new ApiError(400, 'Two-step verification is not enabled.');

  const otp = generateOTP();
  user.twoStepResetOtp = otp;
  user.twoStepResetExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.twoStepResetAttempts = 0;
  await user.save({ validateBeforeSave: false });

  const emailConfigured = isEmailConfigured();
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your ChatConnect PIN',
      html: otpEmailTemplate(user.name, otp),
      text: `Your ChatConnect PIN reset code is ${otp}. It expires in 10 minutes.`,
    });
  } catch (err) {
    console.error('❌ PIN-reset email failed:', err.message);
    securityEvent('twostep.reset.email.failed', req, { userId: String(user._id) });
  }
  securityEvent('twostep.reset.requested', req, { userId: String(user._id) });
  res.json({
    success: true,
    message: `We sent a verification code to ${user.email}.`,
    email: user.email,
    // Dev convenience only: surface the OTP when SMTP isn't set up.
    ...(!emailConfigured && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

// POST /api/auth/two-step/reset  { otp, pin } — verify the emailed OTP and set a
// new PIN. Locked chats stay locked; they open with the NEW PIN afterwards.
export const resetTwoStepPin = asyncHandler(async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) throw new ApiError(400, 'Your new PIN must be 4 to 8 digits.');
  const user = await User.findById(req.user._id).select('+twoStepPin +twoStepResetOtp +twoStepResetExpires +twoStepResetAttempts');
  if (!user.twoStepEnabled) throw new ApiError(400, 'Two-step verification is not enabled.');
  if (!user.twoStepResetOtp) throw new ApiError(400, 'Request a reset code first.');

  // Same brute-force cap as signup OTPs: 5 wrong guesses kills the code.
  if ((user.twoStepResetAttempts || 0) >= 5) {
    securityEvent('twostep.reset.locked', req, { userId: String(user._id) });
    throw new ApiError(429, 'Too many incorrect attempts. Request a new code.');
  }
  if (String(user.twoStepResetOtp) !== String(req.body.otp || '')) {
    user.twoStepResetAttempts = (user.twoStepResetAttempts || 0) + 1;
    await user.save({ validateBeforeSave: false });
    securityEvent('twostep.reset.failure', req, { userId: String(user._id) });
    throw new ApiError(400, 'Invalid verification code.');
  }
  if (user.twoStepResetExpires < Date.now()) throw new ApiError(400, 'Verification code has expired. Request a new one.');

  user.twoStepPin = await bcrypt.hash(pin, 10);
  user.twoStepResetOtp = undefined;
  user.twoStepResetExpires = undefined;
  user.twoStepResetAttempts = 0;
  await user.save({ validateBeforeSave: false });
  securityEvent('twostep.reset.success', req, { userId: String(user._id) });
  res.json({ success: true, message: 'Your PIN has been reset.' });
});

import crypto from 'crypto';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { sendTokenResponse, generateOTP } from '../utils/token.js';
import { sendEmail, otpEmailTemplate } from '../utils/sendEmail.js';
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

  const otp = generateOTP();
  const baseDoc = {
    name: name.trim().slice(0, 60),
    email,
    password, // hashed by the User pre-save hook (bcrypt, cost 12)
    role: 'user', // ALWAYS user — admins are created only via seed/manual promotion
    isVerified: !EMAIL_VERIFY_ON,
    otp: EMAIL_VERIFY_ON ? otp : undefined,
    otpExpires: EMAIL_VERIFY_ON ? new Date(Date.now() + 10 * 60 * 1000) : undefined,
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

  if (EMAIL_VERIFY_ON) {
    await sendEmail({
      to: user.email,
      subject: 'Verify your ChatConnect account',
      html: otpEmailTemplate(name, otp),
      text: `Your ChatConnect verification code is ${otp}`,
    });
    const emailConfigured = Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER);
    return res.status(201).json({
      success: true,
      requiresVerification: true,
      message: emailConfigured
        ? 'Account created. Check your email for the verification code.'
        : 'Account created. Email is not configured — the code is shown below (development only).',
      email: user.email,
      // Dev convenience: when SMTP isn't set up, surface the OTP so signup is testable.
      ...(!emailConfigured && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
    });
  }

  sendTokenResponse(res, user, 201);
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
  sendTokenResponse(res, user);
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
  await sendEmail({
    to: user.email,
    subject: 'Your new ChatConnect code',
    html: otpEmailTemplate(user.name, otp),
    text: `Your ChatConnect verification code is ${otp}`,
  });
  const emailConfigured = Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER);
  res.json({
    success: true,
    message: 'A new code has been sent.',
    ...(!emailConfigured && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new ApiError(400, 'Email and password are required.');
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    securityEvent('login.failure', req, { email: email.toLowerCase() });
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (EMAIL_VERIFY_ON && !user.isVerified) {
    throw new ApiError(403, 'Please verify your email before logging in.');
  }
  if (user.accountStatus !== 'active') {
    throw new ApiError(403, `Your account is ${user.accountStatus}.`);
  }

  user.isOnline = true;
  user.lastSeen = new Date();
  await user.save({ validateBeforeSave: false });
  securityEvent('login.success', req, { userId: String(user._id) });
  sendTokenResponse(res, user);
});

// POST /api/auth/logout
export const logout = asyncHandler(async (req, res) => {
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  if (req.user) {
    req.user.isOnline = false;
    req.user.lastSeen = new Date();
    await req.user.save({ validateBeforeSave: false });
  }
  res.json({ success: true, message: 'Logged out.' });
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
    await sendEmail({
      to: user.email,
      subject: 'Reset your ChatConnect password',
      html: `<p>Reset your password using the link below (valid 30 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      text: `Reset your password: ${resetUrl}`,
    });
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
  securityEvent('password.reset', req, { userId: String(user._id) });
  sendTokenResponse(res, user);
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
  securityEvent('password.change', req, { userId: String(user._id) });
  // Re-issue a token for THIS session so the current device stays logged in
  // (its old token was just invalidated by the tokenVersion bump).
  sendTokenResponse(res, user, 200, { message: 'Password updated.' });
});

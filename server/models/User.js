import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const privacyDefaults = {
  lastSeen: 'everyone', // everyone | contacts | nobody
  profilePhoto: 'everyone',
  about: 'everyone',
  status: 'contacts',
  readReceipts: true,
  groupAddPermission: 'everyone', // everyone | contacts
  onlineStatus: 'everyone',
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-z0-9_.]+$/, 'Username may only contain letters, numbers, "_" and "."'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minlength: [8, 'Password must be at least 8 characters.'],
      select: false,
    },
    avatar: { type: String, default: '' },
    bio: { type: String, default: 'Available on ChatConnect', maxlength: 160 },
    // Normalized phone (optional "+" then 7–15 digits). UNIQUE across accounts —
    // enforced by the partial index below. Empty is allowed (e.g. Google signups)
    // so missing phones never collide with each other.
    phone: { type: String, default: '', trim: true },

    role: { type: String, enum: ['user', 'admin'], default: 'user' }, // platform-level (admin = super-admin)
    accountStatus: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },

    // Multi-tenancy: the org this user belongs to, and their role within it.
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    workspaceRole: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },

    isVerified: { type: Boolean, default: false },
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    // Login OTP (second factor after the password, sent to the phone via SMS —
    // or to the email when SMS isn't configured / the account has no phone).
    loginOtp: { type: String, select: false },
    loginOtpExpires: { type: Date, select: false },
    loginOtpAttempts: { type: Number, default: 0, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    // Bumped on password change / reset to invalidate all previously-issued JWTs.
    tokenVersion: { type: Number, default: 0 },

    // Two-step verification: an app-lock PIN required to open ChatConnect on a
    // device. Stored bcrypt-hashed; never returned to the client.
    twoStepEnabled: { type: Boolean, default: false },
    twoStepPin: { type: String, select: false },
    // Forgot-PIN recovery: a short-lived email OTP that allows resetting the PIN.
    twoStepResetOtp: { type: String, select: false },
    twoStepResetExpires: { type: Date, select: false },
    twoStepResetAttempts: { type: Number, default: 0, select: false },

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },

    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    pinnedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    archivedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    mutedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    // Chat lock: chats hidden from the main list behind the two-step PIN.
    lockedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],

    privacy: { type: Object, default: privacyDefaults },
    settings: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'dark' },
      accent: { type: String, enum: ['indigo', 'violet', 'cyan', 'emerald', 'rose', 'amber'], default: 'indigo' },
      notifications: {
        messages: { type: Boolean, default: true },
        groups: { type: Boolean, default: true },
        calls: { type: Boolean, default: true },
        meetings: { type: Boolean, default: true },
        sound: { type: Boolean, default: true },
      },
      enterToSend: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

userSchema.index({ name: 'text', username: 'text', email: 'text' });
// One phone number = one account. Partial: only non-empty phones are indexed,
// so accounts without a phone (Google signups, legacy users) never collide.
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function matchPassword(entered) {
  return bcrypt.compare(entered, this.password);
};

/** Returns a public-safe object (never leaks password/otp/reset fields). */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.otp;
  delete obj.otpExpires;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.twoStepPin;
  delete obj.twoStepResetOtp;
  delete obj.twoStepResetExpires;
  delete obj.twoStepResetAttempts;
  delete obj.loginOtp;
  delete obj.loginOtpExpires;
  delete obj.loginOtpAttempts;
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;

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
    bio: { type: String, default: 'Available on ChatKonect', maxlength: 160 },
    // Normalized phone (optional "+" then 7–15 digits). UNIQUE across accounts —
    // enforced by the partial index below. Empty is allowed (e.g. Google signups)
    // so missing phones never collide with each other.
    phone: { type: String, default: '', trim: true },

    role: { type: String, enum: ['user', 'admin'], default: 'user' }, // platform-level (admin = super-admin)
    accountStatus: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },

    // Multi-tenancy: the org this user belongs to, and their role within it.
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    workspaceRole: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },

    /* ── Embedded-platform tenancy ──────────────────────────────────
       Set only for END USERS provisioned by a third-party product through the
       /v1 platform API. `null` means a first-party ChatKonect account, and the
       distinction is what every isolation filter keys off (see scopeToTenant):
       a tenant's users must never see, search or message users of another
       tenant, nor our own.

       `externalId` is the host product's own id for the person, so they can
       address users by their existing primary key instead of storing ours.

       NOTE ON UNIQUENESS: email/username stay GLOBALLY unique, and tenant users
       are given synthesized values derived from appId+externalId (see
       synthesizeIdentity). That is deliberate — making those indexes
       tenant-scoped would mean dropping and rebuilding unique indexes on a live
       users collection, and this achieves the same isolation with no migration
       and no window where duplicates could slip in. */
    app: { type: mongoose.Schema.Types.ObjectId, ref: 'App', default: null, index: true },
    externalId: { type: String, default: null },

    isVerified: { type: Boolean, default: false },
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    // Bumped on password change / reset to invalidate all previously-issued JWTs.
    tokenVersion: { type: Number, default: 0 },

    // Two-step verification: an app-lock PIN required to open ChatKonect on a
    // device. Stored bcrypt-hashed; never returned to the client.
    twoStepEnabled: { type: Boolean, default: false },
    twoStepPin: { type: String, select: false },
    // Forgot-PIN recovery: a short-lived email OTP that allows resetting the PIN.
    twoStepResetOtp: { type: String, select: false },
    twoStepResetExpires: { type: Date, select: false },
    twoStepResetAttempts: { type: Number, default: 0, select: false },

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    // Manual presence (Teams-style): available / away / busy / dnd. 'dnd'
    // suppresses push + desktop notifications (in-app bell still records them).
    presenceState: { type: String, enum: ['available', 'away', 'busy', 'dnd'], default: 'available' },

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
      // 'teal' is the brand palette and the default. It has to be in the enum or
      // saving it from Settings -> Appearance fails validation.
      accent: { type: String, enum: ['teal', 'indigo', 'violet', 'cyan', 'emerald', 'rose', 'amber'], default: 'teal' },
      notifications: {
        messages: { type: Boolean, default: true },
        groups: { type: Boolean, default: true },
        calls: { type: Boolean, default: true },
        meetings: { type: Boolean, default: true },
        sound: { type: Boolean, default: true },
      },
      enterToSend: { type: Boolean, default: true },
      // Default chat wallpaper — the id of a preset in the client's wallpaper
      // catalogue, or '' for the plain surface. Per-chat overrides live in
      // `chatThemes` below; this is the fallback for every chat without one.
      wallpaper: { type: String, default: '', maxlength: 64 },
    },

    /**
     * Per-chat appearance, personal to this user (the way WhatsApp wallpapers
     * work — changing yours does not change the other side's). Stored as a
     * sparse override list rather than a field on Chat: only chats you actually
     * customised take up a row, and a chat's document stays shared//neutral.
     */
    chatThemes: [
      {
        _id: false,
        chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
        wallpaper: { type: String, default: '', maxlength: 64 },
        // Optional accent override for the bubbles in this one chat.
        bubble: { type: String, default: '', maxlength: 32 },
        updatedAt: { type: Date, default: Date.now },
      },
    ],

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
/* One end user per (tenant, host's own id) — this is what makes provisioning
   idempotent: a host can POST the same user repeatedly and get an upsert rather
   than duplicates. Partial so the millions of first-party accounts (app: null)
   are excluded entirely and can't collide with each other on a null pair. */
userSchema.index(
  { app: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { app: { $type: 'objectId' }, externalId: { $type: 'string' } } }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function matchPassword(entered) {
  // Accounts created without a local password (OAuth) have none to compare —
  // bcrypt.compare would reject, and login resolves an identifier by trying each
  // candidate in turn, so a throw here would abort before reaching the real match.
  if (!this.password || typeof entered !== 'string' || !entered) return Promise.resolve(false);
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
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;

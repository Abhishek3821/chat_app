import mongoose from 'mongoose';

/**
 * A tracked login session — one per device/login. The refresh token is stored
 * ONLY as a SHA-256 hash (never in plaintext). The short-lived access JWT
 * carries this session's id (`sid`); `protect` validates the session on every
 * request, so revoking a session (logout / "log out other devices" / admin)
 * takes effect immediately regardless of the access token's own expiry.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // SHA-256 of the current refresh token. Rotated on every refresh.
    refreshHash: { type: String, required: true, index: true, select: false },
    device: { type: String, default: 'Unknown device' },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastActiveAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    // Absolute expiry — a TTL index also purges the row from the DB after this.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Session', sessionSchema);

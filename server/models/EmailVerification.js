import mongoose from 'mongoose';

/**
 * Pre-signup email verification: the code sent to an address BEFORE an account
 * exists. One live record per email (upserted on each send). Documents expire
 * automatically an hour after their last update — nothing to clean up.
 */
const emailVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    otp: { type: String, select: false },
    expires: { type: Date },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailVerificationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

const EmailVerification = mongoose.model('EmailVerification', emailVerificationSchema);
export default EmailVerification;

import mongoose from 'mongoose';

/**
 * A Firebase Cloud Messaging (FCM) registration token for one of a user's
 * native app installs (Android / iOS). Browser Web-Push subscriptions live in
 * PushSubscription — this is the mobile-app counterpart.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    appId: { type: String }, // e.g. com.chatkonect
    deviceId: { type: String },
    userAgent: { type: String },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('DeviceToken', deviceTokenSchema);

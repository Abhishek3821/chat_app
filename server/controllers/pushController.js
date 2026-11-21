import PushSubscription from '../models/PushSubscription.js';
import DeviceToken from '../models/DeviceToken.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { pushEnabled, vapidPublicKey, isAllowedPushEndpoint } from '../utils/push.js';
import { fcmEnabled } from '../utils/fcm.js';

const MAX_SUBS_PER_USER = 20;

// GET /api/push/key — the VAPID public key the browser needs to subscribe.
export const getVapidKey = asyncHandler(async (req, res) => {
  res.json({ success: true, enabled: pushEnabled(), publicKey: vapidPublicKey() });
});

// POST /api/push/subscribe  { subscription: { endpoint, keys:{p256dh,auth} } }
export const subscribe = asyncHandler(async (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new ApiError(400, 'A valid push subscription is required.');
  }
  // SSRF guard: only accept endpoints on known push-service hosts, so delivery
  // can never be aimed at an internal/metadata address.
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    throw new ApiError(400, 'Unsupported push endpoint.');
  }
  // Cap devices per user (prevents subscription flooding / delivery amplification).
  const alreadyRegistered = await PushSubscription.findOne({ endpoint: sub.endpoint }).select('_id');
  if (!alreadyRegistered && (await PushSubscription.countDocuments({ user: req.user._id })) >= MAX_SUBS_PER_USER) {
    throw new ApiError(429, 'Too many registered devices. Remove one and try again.');
  }
  // Upsert by endpoint so re-subscribing the same device doesn't duplicate, and
  // re-assigns the device to the current user if it changed hands.
  await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    {
      user: req.user._id,
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      userAgent: req.headers['user-agent'],
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(201).json({ success: true });
});

// POST /api/push/unsubscribe  { endpoint }
export const unsubscribe = asyncHandler(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  res.json({ success: true });
});

// ── Firebase Cloud Messaging (native Android / iOS app) ──────────────────────

const FCM_PLATFORMS = new Set(['android', 'ios', 'web']);

// GET /api/push/fcm/status — lets the app know whether the server can push.
export const fcmStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, enabled: fcmEnabled() });
});

// POST /api/push/fcm/register  { token, platform?: 'android'|'ios'|'web', appId?, deviceId? }
// Call after login and whenever FirebaseMessaging.onNewToken fires.
export const registerFcmToken = asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 4096) throw new ApiError(400, 'A valid FCM token is required.');
  const platform = FCM_PLATFORMS.has(req.body?.platform) ? req.body.platform : 'android';
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  const existing = await DeviceToken.findOne({ token }).select('_id');
  if (!existing && (await DeviceToken.countDocuments({ user: req.user._id })) >= MAX_SUBS_PER_USER) {
    throw new ApiError(429, 'Too many registered devices. Remove one and try again.');
  }
  // One install = one token. If the same physical device registers a new
  // token, drop its old one so it doesn't get duplicate notifications.
  const deviceId = str(req.body?.deviceId);
  if (deviceId) await DeviceToken.deleteMany({ user: req.user._id, deviceId, token: { $ne: token } });

  // Upsert by token — re-assigns the device to the current user if it changed hands.
  await DeviceToken.findOneAndUpdate(
    { token },
    {
      user: req.user._id,
      token,
      platform,
      appId: str(req.body?.appId),
      deviceId,
      userAgent: str(req.headers['user-agent'], 500),
      lastSeenAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(201).json({ success: true, enabled: fcmEnabled() });
});

// POST /api/push/fcm/unregister  { token } — call on logout.
export const unregisterFcmToken = asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (token) await DeviceToken.deleteOne({ token, user: req.user._id });
  res.json({ success: true });
});

import PushSubscription from '../models/PushSubscription.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { pushEnabled, vapidPublicKey, isAllowedPushEndpoint } from '../utils/push.js';

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

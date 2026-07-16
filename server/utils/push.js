import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

/**
 * Web Push (VAPID) delivery. Lets messages reach a user whose tab/app is closed
 * — no held socket required, which is both a UX and a scaling win. Push is
 * disabled gracefully until VAPID keys are configured; FCM/APNs can be added as
 * extra transports behind the same sendPushToUser() entry point later.
 */
const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@chatconnect.app';

let configured = false;
if (PUBLIC && PRIVATE) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  } catch (e) {
    console.warn('⚠️  Web Push disabled — bad VAPID keys:', e.message);
  }
}

export function pushEnabled() {
  return configured;
}

// Known Web Push service hosts. Restricting subscription endpoints to these
// eliminates SSRF — a client cannot point delivery at an internal/metadata host.
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com', // legacy GCM/FCM
  'updates.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge / Windows (*.notify.windows.com)
  '.push.apple.com', // Safari (web.push.apple.com, *.push.apple.com)
];

/** True only for an https URL whose host is a recognised push service. */
export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

export function vapidPublicKey() {
  return configured ? PUBLIC : null;
}

/**
 * Send a notification to every registered device of a user. Dead subscriptions
 * (410 Gone / 404) are pruned automatically. Safe to call unconditionally —
 * returns 0 when push isn't configured or the user has no subscriptions.
 */
export async function sendPushToUser(userId, payload) {
  if (!configured || !userId) return 0;
  const subs = await PushSubscription.find({ user: userId }).lean();
  if (!subs.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.endpoint);
      }
    })
  );
  if (dead.length) await PushSubscription.deleteMany({ endpoint: { $in: dead } }).catch(() => {});
  return sent;
}

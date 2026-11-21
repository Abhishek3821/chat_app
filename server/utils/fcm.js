import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import DeviceToken from '../models/DeviceToken.js';

/**
 * Firebase Cloud Messaging (FCM) delivery to the native mobile apps.
 *
 * Configured from a Firebase *service account* (Firebase Console → Project
 * settings → Service accounts → Generate new private key) — NOT from
 * google-services.json, which is the Android app's client config.
 *
 * Either:
 *   FIREBASE_SERVICE_ACCOUNT   = the whole JSON (raw, or base64-encoded)
 * or the three fields separately:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *
 * Missing/invalid credentials → FCM is simply off; nothing else is affected.
 */
function loadCredentials() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(json);
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // .env files usually hold the key with literal "\n" sequences.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
  return null;
}

let messaging = null;
try {
  const creds = loadCredentials();
  if (creds) {
    const app = getApps().find((a) => a.name === 'chatkonect-fcm') || initializeApp({ credential: cert(creds), projectId: creds.projectId }, 'chatkonect-fcm');
    messaging = getMessaging(app);
  }
} catch (e) {
  console.warn('⚠️  FCM disabled — bad Firebase credentials:', e.message);
  messaging = null;
}

export function fcmEnabled() {
  return !!messaging;
}

const ANDROID_CHANNEL_DEFAULT = process.env.FCM_ANDROID_CHANNEL_ID || 'chatkonect_default';
const ANDROID_CHANNEL_CALLS = process.env.FCM_ANDROID_CALL_CHANNEL_ID || 'chatkonect_calls';

// Errors that mean the token will never work again → delete it.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** FCM `data` values must all be strings. */
function stringifyData(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * Send `payload` ({ type, title, body, tag, data }) to every FCM token of a
 * user. Preference checks (DND / mute / settings) are done by the caller
 * (sendPushToUser). Returns the number of devices reached.
 */
export async function sendFcmToUser(userId, payload = {}) {
  if (!messaging || !userId) return 0;
  const docs = await DeviceToken.find({ user: userId }).select('token').lean();
  if (!docs.length) return 0;

  const isCall = payload.type === 'incoming_call';
  const title = payload.title || 'ChatKonect';
  const body = payload.body || '';
  const data = stringifyData({ ...(payload.data || {}), type: payload.type, title, body, tag: payload.tag });

  const tokens = docs.map((d) => d.token);
  let sent = 0;
  const dead = [];

  // sendEachForMulticast accepts at most 500 tokens per call.
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const message = {
      tokens: batch,
      data,
      notification: { title, body },
      android: {
        priority: 'high',
        ttl: isCall ? 60 * 1000 : 24 * 60 * 60 * 1000,
        collapseKey: payload.tag || undefined,
        notification: {
          channelId: isCall ? ANDROID_CHANNEL_CALLS : ANDROID_CHANNEL_DEFAULT,
          tag: payload.tag || undefined,
          sound: 'default',
          // Optional intent action the app's launcher activity listens for.
          clickAction: process.env.FCM_CLICK_ACTION || undefined,
        },
      },
      apns: {
        headers: { 'apns-priority': '10', ...(payload.tag ? { 'apns-collapse-id': String(payload.tag).slice(0, 64) } : {}) },
        payload: { aps: { sound: 'default', 'mutable-content': 1 } },
      },
    };
    try {
      const res = await messaging.sendEachForMulticast(message);
      sent += res.successCount;
      res.responses.forEach((r, idx) => {
        if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) dead.push(batch[idx]);
      });
    } catch (err) {
      console.warn('FCM send failed:', err.message);
    }
  }

  if (dead.length) await DeviceToken.deleteMany({ token: { $in: dead } }).catch(() => {});
  return sent;
}

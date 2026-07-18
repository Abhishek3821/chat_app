import { enqueue } from './queue.js';

/**
 * One entry point for "tell this user something happened": persists the in-app
 * notification (bell feed) AND fires a Web Push to every device they've
 * enabled push on — so events land even when the app/tab is closed. Both legs
 * run off the request path via the queue (BullMQ when Redis is set, else
 * inline) and no-op gracefully when push isn't configured.
 *
 * `type` must be a Notification-model enum value; `url` is where a click on
 * the device notification takes the user.
 */
export function notifyUser(userId, { from, type = 'system', title, body, url = '/', tag, data = {} }) {
  if (!userId) return;
  const uid = String(userId);
  enqueue('notification.create', { user: uid, from, type, title, body, data });
  enqueue('push.send', {
    userId: uid,
    payload: { title, body, tag, data: { ...data, url } },
  });
}

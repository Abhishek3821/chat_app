import Notification from '../models/Notification.js';
import { registerJob } from './queue.js';
import { sendPushToUser } from './push.js';
import { maybeAutoReply } from './autoReply.js';

/**
 * Register the fan-out job handlers. These run in the BullMQ worker when Redis
 * is configured, or inline otherwise — the same code path either way. Call once
 * at boot, before initQueue().
 */
export function registerFanoutJobs() {
  // Persist an in-app notification.
  registerJob('notification.create', async (data) => {
    await Notification.create(data);
  });

  // Deliver a Web Push notification to all of a user's devices.
  registerJob('push.send', async ({ userId, payload }) => {
    await sendPushToUser(userId, payload);
  });

  // WhatsApp-Business greeting/away auto-reply for inbound customer messages.
  registerJob('automsg.maybe', async ({ chatId, senderId }) => {
    await maybeAutoReply({ chatId, senderId });
  });
}

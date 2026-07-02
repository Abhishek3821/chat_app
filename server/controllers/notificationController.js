import Notification from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/notifications
export const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('from', 'name username avatar');
  const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });
  res.json({ success: true, notifications, unread });
});

// PATCH /api/notifications/read  — mark all read
export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { isRead: true });
  res.json({ success: true });
});

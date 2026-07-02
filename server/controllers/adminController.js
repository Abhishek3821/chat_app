import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Call from '../models/Call.js';
import Report from '../models/Report.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { onlineUserIds } from '../socket/index.js';
import { securityEvent } from '../utils/securityLog.js';

/** Escape user input before using it in a RegExp (prevents ReDoS / regex injection). */
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/admin/stats
export const getStats = asyncHandler(async (req, res) => {
  const [totalUsers, totalGroups, totalMessages, totalCalls, openReports] = await Promise.all([
    User.countDocuments(),
    Chat.countDocuments({ isGroup: true }),
    Message.countDocuments(),
    Call.countDocuments(),
    Report.countDocuments({ status: 'open' }),
  ]);

  // Last 7 days of signups & messages for charts.
  const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);

  const groupByDay = (Model) =>
    Model.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

  const [userGrowth, messageVolume] = await Promise.all([groupByDay(User), groupByDay(Message)]);

  res.json({
    success: true,
    stats: {
      totalUsers,
      activeUsers: onlineUserIds().length,
      totalGroups,
      totalMessages,
      totalCalls,
      openReports,
      userGrowth,
      messageVolume,
    },
  });
});

// GET /api/admin/users?q=
export const listUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const rx = q ? new RegExp(escapeRx(q), 'i') : null;
  const filter = rx ? { $or: [{ email: rx }, { username: rx }, { name: rx }] } : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, users: users.map((u) => u.toSafeJSON()) });
});

// PATCH /api/admin/users/:id/status  { accountStatus }
export const setUserStatus = asyncHandler(async (req, res) => {
  const { accountStatus } = req.body;
  if (!['active', 'suspended', 'banned'].includes(accountStatus)) throw new ApiError(400, 'Invalid status.');
  // Bump tokenVersion so a ban/suspend also kills any live session/token immediately.
  const update = accountStatus === 'active' ? { accountStatus } : { accountStatus, $inc: { tokenVersion: 1 } };
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!user) throw new ApiError(404, 'User not found.');
  securityEvent('admin.user.status', req, { targetUserId: String(user._id), accountStatus });
  res.json({ success: true, user: user.toSafeJSON() });
});

// GET /api/admin/reports
export const listReports = asyncHandler(async (req, res) => {
  const reports = await Report.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('reporter', 'name username avatar')
    .populate('targetUser', 'name username avatar');
  res.json({ success: true, reports });
});

// PATCH /api/admin/reports/:id  { status }
export const updateReport = asyncHandler(async (req, res) => {
  const report = await Report.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!report) throw new ApiError(404, 'Report not found.');
  securityEvent('admin.report.update', req, { reportId: String(report._id), status: req.body.status });
  res.json({ success: true, report });
});

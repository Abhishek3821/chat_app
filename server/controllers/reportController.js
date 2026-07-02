import Report from '../models/Report.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

// POST /api/reports
export const createReport = asyncHandler(async (req, res) => {
  const { targetType, targetUser, targetChat, targetMessage, reason, description } = req.body;
  if (!targetType || !reason) throw new ApiError(400, 'Target type and reason are required.');
  const report = await Report.create({
    reporter: req.user._id,
    targetType,
    targetUser,
    targetChat,
    targetMessage,
    reason,
    description,
  });
  res.status(201).json({ success: true, report });
});

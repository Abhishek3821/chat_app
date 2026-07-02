import { v4 as uuidv4 } from 'uuid';
import Meeting from '../models/Meeting.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const USER_FIELDS = 'name username avatar email';

function populate(query) {
  return query.populate('host', USER_FIELDS).populate('participants.user', USER_FIELDS);
}

// POST /api/meetings
export const createMeeting = asyncHandler(async (req, res) => {
  const { title, description, startAt, durationMinutes, timezone, type, participants = [], recurrence, reminderMinutes, chatId } = req.body;
  if (!title || !startAt) throw new ApiError(400, 'Title and start time are required.');

  let meeting = await Meeting.create({
    title,
    description,
    host: req.user._id,
    startAt,
    durationMinutes,
    timezone,
    type,
    recurrence,
    reminderMinutes,
    chat: chatId,
    link: `${process.env.CLIENT_URL || ''}/meet/${uuidv4().slice(0, 8)}`,
    participants: participants.map((u) => ({ user: u, response: 'pending' })),
  });

  meeting = await populate(Meeting.findById(meeting._id));
  participants.forEach((uid) =>
    emitToUser(String(uid), 'meeting-invited', { meetingId: String(meeting._id), title, startAt })
  );
  res.status(201).json({ success: true, meeting });
});

// GET /api/meetings
export const getMeetings = asyncHandler(async (req, res) => {
  const meetings = await populate(
    Meeting.find({
      $or: [{ host: req.user._id }, { 'participants.user': req.user._id }],
    }).sort({ startAt: 1 })
  );
  res.json({ success: true, meetings });
});

// PATCH /api/meetings/:id
export const updateMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) throw new ApiError(404, 'Meeting not found.');
  if (String(meeting.host) !== String(req.user._id)) throw new ApiError(403, 'Only the host can edit this meeting.');
  Object.assign(meeting, req.body);
  await meeting.save();
  res.json({ success: true, meeting: await populate(Meeting.findById(meeting._id)) });
});

// POST /api/meetings/:id/rsvp  { response }
export const rsvp = asyncHandler(async (req, res) => {
  const { response } = req.body;
  if (!['going', 'maybe', 'not_going'].includes(response)) throw new ApiError(400, 'Invalid RSVP.');
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) throw new ApiError(404, 'Meeting not found.');
  // You can only RSVP to a meeting you were invited to (or that you host).
  // Otherwise anyone could inject themselves into any meeting's participant list.
  const p = meeting.participants.find((x) => String(x.user) === String(req.user._id));
  if (!p && String(meeting.host) !== String(req.user._id)) {
    throw new ApiError(403, 'You have not been invited to this meeting.');
  }
  if (p) p.response = response;
  else meeting.participants.push({ user: req.user._id, response });
  await meeting.save();
  res.json({ success: true, meeting: await populate(Meeting.findById(meeting._id)) });
});

// DELETE /api/meetings/:id  (cancel)
export const cancelMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) throw new ApiError(404, 'Meeting not found.');
  if (String(meeting.host) !== String(req.user._id)) throw new ApiError(403, 'Only the host can cancel.');
  meeting.status = 'cancelled';
  await meeting.save();
  res.json({ success: true });
});

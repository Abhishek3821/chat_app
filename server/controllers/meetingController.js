import Meeting, { generateRoomCode } from '../models/Meeting.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const USER_FIELDS = 'name username avatar email';

function populate(query) {
  return query.populate('host', USER_FIELDS).populate('participants.user', USER_FIELDS);
}

const meetingLink = (roomCode) => `${(process.env.CLIENT_URL || '').replace(/\/+$/, '')}/meet/${roomCode}`;

/** Create a meeting with a unique room code (retries on the rare collision). */
async function createWithRoomCode(doc) {
  for (let i = 0; i < 5; i += 1) {
    const roomCode = generateRoomCode();
    try {
      // eslint-disable-next-line no-await-in-loop
      return await Meeting.create({ ...doc, roomCode, link: meetingLink(roomCode) });
    } catch (err) {
      if (err?.code === 11000 && i < 4) continue; // duplicate roomCode — try again
      throw err;
    }
  }
  throw new ApiError(500, 'Could not allocate a meeting room. Please retry.');
}

// POST /api/meetings
// Works for BOTH a scheduled meeting (title + startAt + invitees) and an instant
// "start now" meeting (no startAt/participants → shareable link, join immediately).
export const createMeeting = asyncHandler(async (req, res) => {
  const { title, description, startAt, durationMinutes, timezone, type, participants = [], recurrence, reminderMinutes, chatId } = req.body;
  if (!Array.isArray(participants)) throw new ApiError(400, 'participants must be a list.');
  const instant = !startAt;

  // Tenant isolation for INVITES: only real users in the SAME workspace can be
  // pre-invited (matches createGroup). Anyone can still JOIN later via the link.
  const requested = [...new Set(participants.map(String))].filter((id) => id !== String(req.user._id));
  const sameWs = requested.length
    ? (await User.find({ _id: { $in: requested }, workspace: req.user.workspace }).select('_id')).map((u) => String(u._id))
    : [];

  let meeting = await createWithRoomCode({
    title: (title || '').trim() || 'Instant meeting',
    description,
    host: req.user._id,
    startAt: startAt || new Date(),
    durationMinutes,
    timezone,
    type,
    recurrence,
    reminderMinutes,
    chat: chatId,
    status: instant ? 'ongoing' : 'scheduled',
    participants: sameWs.map((u) => ({ user: u, response: 'pending' })),
  });

  meeting = await populate(Meeting.findById(meeting._id));
  sameWs.forEach((uid) =>
    emitToUser(String(uid), 'meeting-invited', { meetingId: String(meeting._id), title: meeting.title, startAt: meeting.startAt })
  );
  res.status(201).json({ success: true, meeting });
});

// GET /api/meetings/code/:code — summary for anyone holding the link (before join)
export const getMeetingByCode = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ roomCode: req.params.code }).populate('host', 'name username avatar');
  if (!meeting) throw new ApiError(404, 'This meeting link is invalid or has expired.');
  if (meeting.status === 'cancelled') throw new ApiError(410, 'This meeting has been cancelled.');
  res.json({
    success: true,
    meeting: {
      _id: meeting._id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      startAt: meeting.startAt,
      roomCode: meeting.roomCode,
      host: meeting.host,
    },
  });
});

// POST /api/meetings/code/:code/join — join via the shareable link (Google-Meet
// style: anyone signed in with the link may join). Adds you to the roster so the
// host sees who joined and the meeting appears in your list.
export const joinMeetingByCode = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ roomCode: req.params.code });
  if (!meeting) throw new ApiError(404, 'This meeting link is invalid or has expired.');
  if (meeting.status === 'cancelled') throw new ApiError(410, 'This meeting has been cancelled.');

  const already = meeting.participants.some((p) => String(p.user) === String(req.user._id));
  const isHost = String(meeting.host) === String(req.user._id);
  if (!already && !isHost) meeting.participants.push({ user: req.user._id, response: 'going' });
  if (meeting.status === 'scheduled') meeting.status = 'ongoing'; // it's live the moment someone joins
  await meeting.save();

  const populated = await populate(Meeting.findById(meeting._id));
  res.json({ success: true, meeting: populated });
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
  // Whitelist editable fields — never let the body reassign host/participants/
  // link/chat/status via mass assignment.
  const ALLOWED = ['title', 'description', 'startAt', 'durationMinutes', 'timezone', 'type', 'recurrence', 'reminderMinutes'];
  for (const k of ALLOWED) if (req.body[k] !== undefined) meeting[k] = req.body[k];
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

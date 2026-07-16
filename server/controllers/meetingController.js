import mongoose from 'mongoose';
import Meeting, { generateRoomCode } from '../models/Meeting.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';
import { sendEmail } from '../utils/sendEmail.js';

const USER_FIELDS = 'name username avatar email';

function populate(query) {
  return query.populate('host', USER_FIELDS).populate('participants.user', USER_FIELDS);
}

const meetingLink = (roomCode) => `${(process.env.CLIENT_URL || '').replace(/\/+$/, '')}/meet/${roomCode}`;

/** Look a meeting up by its shareable room code OR its raw id ("join by meeting ID"). */
async function findByCodeOrId(param) {
  let m = await Meeting.findOne({ roomCode: param });
  if (!m && mongoose.isValidObjectId(param)) m = await Meeting.findById(param);
  return m;
}

/** Whitelist the host-controlled policy toggles (never trust the raw object). */
function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  if (s.joinAnytime !== undefined) out.joinAnytime = Boolean(s.joinAnytime);
  if (s.muteOnEntry !== undefined) out.muteOnEntry = Boolean(s.muteOnEntry);
  if (s.autoRecord !== undefined) out.autoRecord = Boolean(s.autoRecord);
  return out;
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Fire-and-forget email invitations (never blocks or fails the request). */
function sendMeetingInvites({ meeting, hostName, emails }) {
  const unique = [...new Set(emails.filter((e) => EMAIL_RE.test(e)))].slice(0, 50);
  if (!unique.length) return;
  let when = '';
  try {
    when = new Date(meeting.startAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: meeting.timezone || 'UTC' });
  } catch {
    when = new Date(meeting.startAt).toUTCString();
  }
  const tz = meeting.timezone || 'UTC';
  const html = `
    <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4);padding:24px"><h1 style="margin:0;color:#fff;font-size:20px">ChatConnect Meeting</h1></div>
      <div style="padding:24px">
        <p><strong>${hostName || 'Someone'}</strong> invited you to a ${meeting.type || 'video'} meeting.</p>
        <p style="font-size:18px;font-weight:700;margin:6px 0">${meeting.title}</p>
        <p style="color:#94a3b8">🗓️ ${when} (${tz})</p>
        <p style="margin:20px 0"><a href="${meeting.link}" style="background:#6366f1;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Join meeting</a></p>
        <p style="color:#94a3b8;font-size:13px">Or join with meeting ID <b>${meeting.roomCode}</b> · ${meeting.link}</p>
      </div>
    </div>`;
  const text = `${hostName || 'Someone'} invited you to "${meeting.title}" on ${when} (${tz}). Join: ${meeting.link} (meeting ID ${meeting.roomCode})`;
  unique.forEach((to) => sendEmail({ to, subject: `Invitation: ${meeting.title}`, html, text }).catch(() => {}));
}

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
  const { title, description, startAt, durationMinutes, timezone, type, participants = [], recurrence, reminderMinutes, chatId, inviteEmails = [] } = req.body;
  if (!Array.isArray(participants)) throw new ApiError(400, 'participants must be a list.');
  if (!Array.isArray(inviteEmails)) throw new ApiError(400, 'inviteEmails must be a list.');
  const instant = !startAt;

  // Tenant isolation for INVITES: only real users in the SAME workspace can be
  // pre-invited (matches createGroup). Anyone can still JOIN later via the link.
  const requested = [...new Set(participants.map(String))].filter((id) => id !== String(req.user._id));
  const invited = requested.length
    ? await User.find({ _id: { $in: requested }, workspace: req.user.workspace }).select('_id email')
    : [];

  let meeting = await createWithRoomCode({
    title: (title || '').trim() || 'Instant meeting',
    description,
    host: req.user._id,
    startAt: startAt || new Date(),
    durationMinutes,
    timezone: typeof timezone === 'string' && timezone ? timezone.slice(0, 64) : 'UTC',
    type,
    recurrence,
    reminderMinutes,
    chat: chatId,
    status: instant ? 'ongoing' : 'scheduled',
    settings: sanitizeSettings(req.body.settings),
    participants: invited.map((u) => ({ user: u._id, response: 'pending' })),
  });

  meeting = await populate(Meeting.findById(meeting._id));
  invited.forEach((u) =>
    emitToUser(String(u._id), 'meeting-invited', { meetingId: String(meeting._id), title: meeting.title, startAt: meeting.startAt })
  );

  // Email invitations (in-workspace invitees + any raw email addresses) — the
  // shareable link is included so anyone can join. Best-effort, off the response.
  sendMeetingInvites({
    meeting,
    hostName: req.user.name,
    emails: [...invited.map((u) => u.email), ...inviteEmails.map((e) => String(e).trim().toLowerCase())],
  });

  res.status(201).json({ success: true, meeting });
});

// GET /api/meetings/code/:code — summary for anyone holding the link (before join).
// `:code` may be the room code OR the raw meeting id (join-by-meeting-ID).
export const getMeetingByCode = asyncHandler(async (req, res) => {
  const meeting = await findByCodeOrId(req.params.code);
  if (!meeting) throw new ApiError(404, 'This meeting link is invalid or has expired.');
  if (meeting.status === 'cancelled') throw new ApiError(410, 'This meeting has been cancelled.');
  await meeting.populate('host', 'name username avatar');
  res.json({
    success: true,
    meeting: {
      _id: meeting._id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      startAt: meeting.startAt,
      timezone: meeting.timezone,
      roomCode: meeting.roomCode,
      host: meeting.host,
      settings: meeting.settings,
      isHost: String(meeting.host?._id || meeting.host) === String(req.user._id),
    },
  });
});

// POST /api/meetings/code/:code/join — join via the shareable link (Google-Meet
// style: anyone signed in with the link may join). Adds you to the roster so the
// host sees who joined and the meeting appears in your list.
export const joinMeetingByCode = asyncHandler(async (req, res) => {
  const meeting = await findByCodeOrId(req.params.code);
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

const durationBetween = (startedAt, endedAt) =>
  startedAt && endedAt ? Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000)) : 0;

// GET /api/meetings
export const getMeetings = asyncHandler(async (req, res) => {
  const docs = await populate(
    Meeting.find({
      $or: [{ host: req.user._id }, { 'participants.user': req.user._id }],
    }).sort({ startAt: 1 })
  );
  const meetings = docs.map((m) => {
    const o = m.toObject();
    const isHost = String(m.host?._id || m.host) === String(req.user._id);
    o.attendeeCount = (o.attendees || []).length;
    o.durationSeconds = durationBetween(o.startedAt, o.endedAt);
    // The detailed attendance record (names + emails) is HOST-ONLY.
    if (!isHost) delete o.attendees;
    return o;
  });
  res.json({ success: true, meetings });
});

// GET /api/meetings/:id/report — full attendance record (host only)
export const getMeetingReport = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id).populate('host', USER_FIELDS);
  if (!meeting) throw new ApiError(404, 'Meeting not found.');
  if (String(meeting.host?._id || meeting.host) !== String(req.user._id)) {
    throw new ApiError(403, 'Only the host can view the attendance report.');
  }
  const attendees = (meeting.attendees || [])
    .slice()
    .sort((a, b) => new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0))
    .map((a) => ({ name: a.name, email: a.email, joinedAt: a.joinedAt, leftAt: a.leftAt, durationSeconds: a.durationSeconds || 0 }));
  res.json({
    success: true,
    report: {
      _id: meeting._id,
      title: meeting.title,
      type: meeting.type,
      host: meeting.host,
      status: meeting.status,
      scheduledAt: meeting.startAt,
      timezone: meeting.timezone,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      durationSeconds: durationBetween(meeting.startedAt, meeting.endedAt),
      attendeeCount: attendees.length,
      attendees,
    },
  });
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
  const nextSettings = sanitizeSettings(req.body.settings);
  if (nextSettings) { meeting.settings = { ...(meeting.settings?.toObject?.() ?? meeting.settings), ...nextSettings }; meeting.markModified('settings'); }
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

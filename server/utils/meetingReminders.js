import Meeting from '../models/Meeting.js';
import { notifyUser } from './notify.js';
import { emitToUser } from '../socket/index.js';

let timer;

export async function dispatchMeetingReminders(now = new Date()) {
  const candidates = await Meeting.find({
    status: 'scheduled',
    startAt: { $gt: now, $lte: new Date(now.getTime() + 60 * 60 * 1000) },
    reminderSentAt: null,
  }).select('title startAt reminderMinutes host participants roomCode').limit(100);
  for (const meeting of candidates) {
    const minutes = Math.max(1, Math.min(60, Number(meeting.reminderMinutes) || 10));
    if (meeting.startAt.getTime() - minutes * 60_000 > now.getTime()) continue;
    const claimed = await Meeting.updateOne(
      { _id: meeting._id, reminderSentAt: null, status: 'scheduled' },
      { $set: { reminderSentAt: now } }
    );
    if (!claimed.modifiedCount) continue;
    const recipients = new Set([String(meeting.host), ...meeting.participants
      .filter((p) => p.response !== 'not_going').map((p) => String(p.user))]);
    for (const id of recipients) {
      const event = { meetingId: String(meeting._id), title: meeting.title, startAt: meeting.startAt };
      emitToUser(id, 'meeting-reminder', event);
      notifyUser(id, {
        type: 'meeting_reminder',
        title: 'Meeting starting soon',
        body: `“${meeting.title}” starts in about ${minutes} minutes.`,
        url: `/meet/${meeting.roomCode}`,
        tag: `meeting-reminder:${meeting._id}`,
        data: event,
      });
    }
  }
}

export function startMeetingReminders() {
  if (timer) return;
  timer = setInterval(() => dispatchMeetingReminders().catch(() => {}), 30_000);
  timer.unref?.();
  dispatchMeetingReminders().catch(() => {});
}

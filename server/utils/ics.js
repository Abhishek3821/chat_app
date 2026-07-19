/**
 * Minimal iCalendar (.ics) generator for meeting invites — no dependency.
 * Produces a VEVENT with UTC start/end so Google Calendar, Outlook and Apple
 * Calendar all render "Add to calendar" from the attachment.
 */

/** Date → iCal UTC timestamp: YYYYMMDDTHHMMSSZ */
function toICSDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const RECURRENCE = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

/**
 * Build an .ics string for a meeting.
 * @param {{ _id:string, title?:string, startAt:Date|string, durationMinutes?:number,
 *           link?:string, roomCode?:string, recurrence?:string, hostName?:string }} m
 */
export function buildMeetingICS(m) {
  const start = new Date(m.startAt);
  const end = new Date(start.getTime() + (m.durationMinutes || 30) * 60 * 1000);
  const rrule = RECURRENCE[m.recurrence] ? `\r\nRRULE:FREQ=${RECURRENCE[m.recurrence]}` : '';
  const desc = `Join: ${m.link || ''}${m.roomCode ? ` (meeting ID ${m.roomCode})` : ''}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChatConnect//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${m._id}@chatconnect`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${esc(m.title || 'ChatConnect Meeting')}`,
    `DESCRIPTION:${esc(desc)}`,
    m.link ? `URL:${esc(m.link)}` : '',
    m.link ? `LOCATION:${esc(m.link)}` : '',
    m.hostName ? `ORGANIZER;CN=${esc(m.hostName)}:mailto:no-reply@chatconnect.app` : '',
    'STATUS:CONFIRMED',
    `SEQUENCE:0${rrule}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n`;
}

import mongoose from 'mongoose';
import crypto from 'crypto';

const rsvpSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    response: { type: String, enum: ['going', 'maybe', 'not_going', 'pending'], default: 'pending' },
    // True when this row came from a shareable-link join rather than a real
    // invite. Link-joiners still get the meeting in their list, but they do NOT
    // count as "invited" for the ask-to-join admission gate.
    viaLink: { type: Boolean, default: false },
  },
  { _id: false }
);

// One row per person who actually JOINED the live room (attendance record).
// name/email are snapshotted at join time; durationSeconds accumulates across
// any rejoins; joinedAt is the first entry, leftAt the last exit.
const attendeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    email: { type: String },
    joinedAt: { type: Date },
    leftAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    participants: [rsvpSchema],
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },

    startAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 30 },
    timezone: { type: String, default: 'UTC' },

    type: { type: String, enum: ['audio', 'video'], default: 'video' },
    // Google-Meet-style shareable room code (e.g. "abc-defg-hij"). Anyone with
    // the code/link can join the live room. Unguessable so it can't be brute-forced.
    roomCode: { type: String, unique: true, index: true },
    link: { type: String },
    // Host-controlled meeting policy — enforced for participants (not the host):
    //  • joinAnytime  — if false, guests can only join once the host is present.
    //  • muteOnEntry  — guests join with their mic muted.
    //  • autoRecord   — guests' clients auto-start a local recording on join.
    //  • askToJoin    — Google-Meet-style admission: people who weren't invited
    //                   (not the host, not on the participants list) must knock
    //                   and be admitted by the host before they can enter.
    settings: {
      joinAnytime: { type: Boolean, default: true },
      muteOnEntry: { type: Boolean, default: false },
      autoRecord: { type: Boolean, default: false },
      askToJoin: { type: Boolean, default: true },
    },
    recurrence: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    reminderMinutes: { type: Number, default: 10 },

    status: { type: String, enum: ['scheduled', 'ongoing', 'completed', 'cancelled'], default: 'scheduled' },

    // Live-attendance record: when the room actually started/ended (first join →
    // last leave) and everyone who attended. Populated by the socket room events.
    startedAt: { type: Date, default: null },
    endedAt: { type: Date },
    attendees: [attendeeSchema],
  },
  { timestamps: true }
);

meetingSchema.index({ startAt: 1 });

/** A readable, unguessable "abc-defg-hij" room code (CSPRNG). */
export function generateRoomCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
  const pick = (n) => Array.from({ length: n }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

const Meeting = mongoose.model('Meeting', meetingSchema);
export default Meeting;

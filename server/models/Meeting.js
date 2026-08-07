import mongoose from 'mongoose';
import crypto from 'crypto';

const rsvpSchema = new mongoose.Schema(
  {
    // Indexed: getMeetings does `{ $or: [{ host }, { 'participants.user' }] }`
    // on every "my meetings" load — without this it's a full collection scan.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
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

/**
 * In-meeting poll. Tallies are stored as one row per voter rather than a counter
 * so the "one vote per person" rule is enforceable server-side — a relayed
 * counter could be incremented twice by a client, or forged outright.
 */
const pollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    options: [{ type: String, trim: true, maxlength: 120 }],
    multi: { type: Boolean, default: false },
    closed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // { user, choices: [optionIndex] } — replacing a voter's row is how a re-vote
    // works, which keeps the tally correct without a separate dedupe pass.
    votes: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        choices: [{ type: Number }],
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/** Audience question (Q&A). Upvoters are stored as ids for the same reason. */
const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    askedByName: { type: String },
    anonymous: { type: Boolean, default: false },
    upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    answered: { type: Boolean, default: false },
    answerText: { type: String, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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
    polls: [pollSchema],
    questions: [questionSchema],
    // Rolling transcript of live captions, kept so the meeting report can include
    // what was said. Capped in the socket handler — an unbounded array on a hot
    // document would grow without limit over a long meeting.
    transcript: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        text: { type: String, maxlength: 1000 },
        at: { type: Date, default: Date.now },
      },
    ],
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

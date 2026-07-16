import mongoose from 'mongoose';
import crypto from 'crypto';

const rsvpSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    response: { type: String, enum: ['going', 'maybe', 'not_going', 'pending'], default: 'pending' },
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
    recurrence: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    reminderMinutes: { type: Number, default: 10 },

    status: { type: String, enum: ['scheduled', 'ongoing', 'completed', 'cancelled'], default: 'scheduled' },
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

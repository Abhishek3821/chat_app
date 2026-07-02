import mongoose from 'mongoose';

const callParticipantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['ringing', 'joined', 'left', 'rejected', 'missed'], default: 'ringing' },
    joinedAt: Date,
    leftAt: Date,
  },
  { _id: false }
);

const callSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['audio', 'video'], default: 'audio' },
    isGroup: { type: Boolean, default: false },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    // `initiator` is the historical name; `caller`/`receiver` are explicit 1:1 fields.
    initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    participants: [callParticipantSchema],
    status: {
      type: String,
      // 'accepted' = live right now ('ongoing' kept for legacy records).
      enum: ['ringing', 'accepted', 'ongoing', 'completed', 'missed', 'rejected'],
      default: 'ringing',
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: Date,
    endedAt: Date,
    duration: { type: Number, default: 0 }, // seconds
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// `callType` is an alias so API consumers can use either name.
callSchema.virtual('callType').get(function callType() {
  return this.type;
});

callSchema.index({ initiator: 1, createdAt: -1 });
callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ receiver: 1, createdAt: -1 });

const Call = mongoose.model('Call', callSchema);
export default Call;

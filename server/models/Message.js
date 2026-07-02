import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema(
  {
    url: String,
    name: String,
    size: Number,
    mime: String,
    width: Number,
    height: Number,
    duration: Number, // seconds, for audio/video/voice
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'voice', 'document', 'location', 'system'],
      default: 'text',
    },
    content: { type: String, default: '' },
    attachments: [attachmentSchema],
    location: { lat: Number, lng: Number, label: String },

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    reactions: [reactionSchema],
    readBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    editedAt: Date,
    isEdited: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }, // deleted for everyone
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // deleted for me

    systemEvent: { type: String }, // e.g. "member_added", "group_created"
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ content: 'text' });

const Message = mongoose.model('Message', messageSchema);
export default Message;

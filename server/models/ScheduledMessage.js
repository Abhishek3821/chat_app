import mongoose from 'mongoose';

/**
 * A message queued to be sent later.
 *
 * Deliberately a SEPARATE collection rather than a flag on `Message`. `Message`
 * is read by chat history, in-chat search, starred, unread counts and a chat's
 * `lastMessage` pointer — an unsent row leaking into any one of those is a
 * correctness bug, and every one of those read paths would need a new filter.
 * Keeping the pending rows out of `Message` entirely makes that impossible.
 *
 * The real `Message` is only created at dispatch, via the shared
 * `deliverMessage()` helper, and linked back here as `sentMessage`.
 */
const attachmentSchema = new mongoose.Schema(
  {
    url: String,
    name: String,
    size: Number,
    mime: String,
    width: Number,
    height: Number,
    duration: Number,
  },
  { _id: false }
);

const scheduledMessageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type: {
      type: String,
      enum: ['text', 'image', 'video', 'videoNote', 'audio', 'voice', 'document', 'location'],
      default: 'text',
    },
    content: { type: String, default: '' },
    attachments: [attachmentSchema],
    location: { type: Object },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    sendAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    // Set when a 'sending' claim was taken, so a row orphaned by a process that
    // died mid-dispatch can be reclaimed instead of sticking forever.
    claimedAt: { type: Date },
    sentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    error: { type: String },
  },
  { timestamps: true }
);

// The dispatcher's hot query: due rows in a claimable state.
scheduledMessageSchema.index({ status: 1, sendAt: 1 });
// Listing a user's pending items for one chat.
scheduledMessageSchema.index({ chat: 1, sender: 1, status: 1, sendAt: 1 });

export default mongoose.model('ScheduledMessage', scheduledMessageSchema);

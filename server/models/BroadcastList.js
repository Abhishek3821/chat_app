import mongoose from 'mongoose';

/**
 * A BroadcastList (WhatsApp-style) lets a user send one message to many contacts
 * at once, where each recipient receives it in their OWN 1:1 chat — they never
 * see the other recipients. The list itself is private to its owner.
 */
const broadcastListSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

export default mongoose.model('BroadcastList', broadcastListSchema);

import mongoose from 'mongoose';

/**
 * A QuickReply is a canned response (WhatsApp-Business style) shared across a
 * workspace's agents. Each has a "/shortcut" and message text; the client
 * expands the shortcut into the composer. Managed by workspace managers.
 */
const quickReplySchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    shortcut: { type: String, required: true, trim: true, maxlength: 40 },
    text: { type: String, required: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

quickReplySchema.index({ workspace: 1, shortcut: 1 }, { unique: true });

export default mongoose.model('QuickReply', quickReplySchema);

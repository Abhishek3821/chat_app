import mongoose from 'mongoose';

/**
 * A Label is a workspace-defined tag (WhatsApp-Business style) that agents apply
 * to chats to organise conversations — e.g. "New customer", "Pending payment".
 * Labels belong to a workspace and are shared by all its members; applied labels
 * are stored on the Chat (Chat.labels) and only shown to that workspace's members.
 */
const labelSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, default: '#6366f1', maxlength: 20 }, // hex or css color
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

labelSchema.index({ workspace: 1, name: 1 }, { unique: true });

export default mongoose.model('Label', labelSchema);

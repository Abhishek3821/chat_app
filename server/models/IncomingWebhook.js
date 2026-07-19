import mongoose from 'mongoose';

/**
 * Incoming webhook: a secret URL that lets an EXTERNAL service (CI, monitoring,
 * a form) post a message into a specific group chat without a user session.
 * The unguessable `token` in the URL is the only credential — treat it like a
 * password. Messages are attributed to the creator, tagged with the label.
 */
const incomingWebhookSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, default: 'Webhook', maxlength: 60 },
    active: { type: Boolean, default: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const IncomingWebhook = mongoose.model('IncomingWebhook', incomingWebhookSchema);
export default IncomingWebhook;

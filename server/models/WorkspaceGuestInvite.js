import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  chats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
  expiresAt: { type: Date, required: true },
  accessDays: { type: Number, default: null },
  claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

schema.index({ workspace: 1, createdAt: -1 });
export default mongoose.model('WorkspaceGuestInvite', schema);

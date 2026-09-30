import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 80 },
  target: { type: String, default: '', maxlength: 180 },
  detail: { type: String, default: '', maxlength: 500 },
}, { timestamps: true });

schema.index({ workspace: 1, createdAt: -1 });
export default mongoose.model('WorkspaceAudit', schema);

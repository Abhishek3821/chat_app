import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, default: '', maxlength: 3000 },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dueAt: { type: Date, default: null },
  reminderSentAt: { type: Date, default: null },
  status: { type: String, enum: ['open', 'done'], default: 'open' },
  source: {
    kind: { type: String, enum: ['manual', 'message', 'meeting'], default: 'manual' },
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
}, { timestamps: true });

schema.index({ workspace: 1, status: 1, dueAt: 1 });
export default mongoose.model('WorkspaceTask', schema);

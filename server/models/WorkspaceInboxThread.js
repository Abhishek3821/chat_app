import mongoose from 'mongoose';

const entry = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 5000 },
  at: { type: Date, default: Date.now },
}, { _id: true });

const schema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['open', 'pending', 'closed'], default: 'open' },
  messages: [entry],
  notes: [entry],
}, { timestamps: true });

schema.index({ workspace: 1, customer: 1 }, { unique: true });
schema.index({ workspace: 1, updatedAt: -1 });

export default mongoose.model('WorkspaceInboxThread', schema);

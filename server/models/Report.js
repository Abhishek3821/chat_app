import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['user', 'group', 'message', 'status'], required: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetChat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    targetMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    reason: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open' },
  },
  { timestamps: true }
);

const Report = mongoose.model('Report', reportSchema);
export default Report;

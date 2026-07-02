import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: [
        'message',
        'group_message',
        'mention',
        'incoming_call',
        'missed_call',
        'meeting_reminder',
        'status_reply',
        'contact_request',
        'system',
      ],
      default: 'message',
    },
    title: String,
    body: String,
    data: { type: Object, default: {} },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

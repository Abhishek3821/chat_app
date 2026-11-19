import mongoose from 'mongoose';

/**
 * Per-user read watermark for a chat: "everything in `chat` created at or
 * before `lastReadAt` has been read by `user`".
 *
 * Unread counts used to be computed by scanning a chat's ENTIRE history for
 * messages whose `readBy` didn't contain the user (a `$ne` no index can serve),
 * on every chat-list load, and every mark-read re-scanned it again. With a
 * watermark, unread = messages after `lastReadAt` — a short range on the
 * existing `{chat, createdAt}` index, however long the conversation is.
 *
 * Kept in its own collection rather than on Chat.participants on purpose:
 * participant lists are sent to every member, and this timestamp would reveal
 * when each person last read the chat even with read receipts turned off.
 */
const chatReadSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { versionKey: false }
);

chatReadSchema.index({ user: 1, chat: 1 }, { unique: true });
chatReadSchema.index({ chat: 1 });

export default mongoose.model('ChatRead', chatReadSchema);

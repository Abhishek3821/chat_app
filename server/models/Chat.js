import crypto from 'crypto';
import mongoose from 'mongoose';

/**
 * A Chat is the unified conversation container for both 1:1 and group chats
 * (`isGroup` distinguishes them). This is cleaner than separate Group /
 * GroupMember collections while still modelling roles, admins and policies.
 */
const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'admin', 'owner'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    // Tenant this chat belongs to (all participants share it). Set on creation.
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    isGroup: { type: Boolean, default: false },
    participants: [participantSchema],

    // Group-only metadata
    name: { type: String, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 500, default: '' },
    avatar: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    inviteCode: { type: String, unique: true, sparse: true },
    messagingPolicy: { type: String, enum: ['all', 'admins'], default: 'all' },

    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    pinnedMessages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
  },
  { timestamps: true }
);

chatSchema.index({ 'participants.user': 1, updatedAt: -1 });

const genCode = () => {
  // Readable, unguessable invite code. Uses a CSPRNG (crypto.randomInt) rather
  // than Math.random() so codes can't be predicted from one another.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) out += chars[crypto.randomInt(0, chars.length)];
  return out;
};

chatSchema.pre('save', function ensureInviteCode(next) {
  if (this.isGroup && !this.inviteCode) this.inviteCode = genCode();
  next();
});

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;

import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * A Community groups several group-chats under one umbrella (WhatsApp-style),
 * with an admins-only "Announcements" group everyone in the community sees, plus
 * any number of linked topic groups. Membership is tracked here; joining adds
 * the user to the announcement group so they receive community-wide posts.
 */
const communityMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
  },
  { _id: false }
);

const communitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },
    avatar: { type: String, default: '' },
    // Optional owning workspace (null for a personal community).
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [communityMemberSchema],
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    announcementGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    inviteCode: { type: String, unique: true, index: true },
  },
  { timestamps: true }
);

communitySchema.index({ 'members.user': 1, updatedAt: -1 });

communitySchema.pre('save', function ensureInviteCode(next) {
  if (!this.inviteCode) this.inviteCode = crypto.randomBytes(9).toString('base64url'); // ~12 chars
  next();
});

export default mongoose.model('Community', communitySchema);

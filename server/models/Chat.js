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

    /**
     * Pinned messages, each with an expiry the pinner chose (1 / 6 / 12 / 24
     * hours). A pin is a chat-wide thing, not a personal bookmark — that's what
     * starring is for — so it lives here rather than on the User.
     *
     * Deliberately a NEW field rather than a reshape of the old
     * `pinnedMessages: [ObjectId]`: hydrating a document whose array holds raw
     * ObjectIds against a subdocument schema throws a CastError, so reusing the
     * name would break every chat that had ever been pinned in. The old field is
     * simply no longer in the schema — Mongoose ignores it, and the previous
     * pins were invisible anyway (nothing rendered them).
     *
     * Expiry is enforced two ways, because neither alone is enough: reads filter
     * on `expiresAt` so a lapsed pin is never shown even if the sweeper is
     * behind, and utils/pins.js sweeps them out on a timer so open clients get
     * told and rows don't accumulate. A TTL index can't do this — those only
     * delete whole documents, not entries in an array.
     */
    pins: [
      {
        _id: false,
        message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
        pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        pinnedAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
        durationHours: { type: Number }, // 1 | 6 | 12 | 24 — kept for the UI label
      },
    ],

    // Disappearing messages: seconds after which new messages self-delete
    // (0 = off). Applied to every message sent into this chat.
    disappearingSeconds: { type: Number, default: 0, min: 0 },

    // WhatsApp-Business labels applied to this chat. Labels are workspace-scoped;
    // the client only surfaces labels belonging to the viewer's own workspace.
    labels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Label' }],

    /**
     * End-to-end encryption for this conversation.
     *
     * The chat is sealed with a symmetric key that ONLY members hold. The server
     * stores one copy of that key per member, each already wrapped by the
     * client under an ECDH secret derived between the enabling member's
     * identity key and that member's — so what lands here is ciphertext the
     * server has no way to open. It never sees the chat key or any private key.
     *
     * `version` exists for membership churn: adding someone to a group mints a
     * new version they get a copy of, so they can read from that point on but
     * not the history sealed under earlier versions. Old versions stay in
     * `keys` for the members who already had them.
     */
    e2ee: {
      enabled: { type: Boolean, default: false },
      version: { type: Number, default: 0 }, // current (highest) key version
      enabledAt: { type: Date },
      enabledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      keys: [
        {
          _id: false,
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          version: { type: Number, required: true },
          wrapped: { type: String, required: true }, // base64 AES-GCM-wrapped chat key
          iv: { type: String, required: true }, // base64 nonce used for the wrap
          // Ephemeral ECDH public key the wrap was derived against. Ephemeral
          // (not the sender's identity key) so a leaked identity key can't
          // retroactively unwrap past chat keys.
          senderPublicKey: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
  },
  { timestamps: true }
);

chatSchema.index({ 'participants.user': 1, updatedAt: -1 });
// A member fetching their own wrapped key copies for a chat.
chatSchema.index({ 'e2ee.keys.user': 1 });
// The pin sweeper asks "which chats have an expired pin?" every minute. Without
// this it's a full collection scan on a timer, forever.
chatSchema.index({ 'pins.expiresAt': 1 });
// Global search matches group chats by name; `$text` keeps that off a regex scan.
chatSchema.index({ name: 'text' });

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

import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema(
  {
    url: String,
    name: String,
    size: Number,
    mime: String,
    width: Number,
    height: Number,
    duration: Number, // seconds, for audio/video/voice

    /**
     * Set when the file at `url` is AES-GCM ciphertext rather than the media
     * itself (an attachment in an end-to-end encrypted chat).
     *
     * Only the nonce and the chat-key version are here — the key is not, and
     * never reaches this server. `name`/`mime`/`size` above describe the ORIGINAL
     * file, because that is what the recipient gets back after decrypting and
     * what the UI needs in order to know it has an image rather than a download.
     */
    enc: {
      iv: { type: String }, // base64 nonce
      v: { type: Number }, // chat-key version the file was sealed under
    },
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String,
  },
  { _id: false }
);

const pollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

const pollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: [pollOptionSchema],
    multi: { type: Boolean, default: false }, // allow selecting more than one option
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      // 'videoNote' = Telegram-style round clip. Its own type rather than a flag
      // on 'video' so the bubble renders circular without sniffing the mime type.
      enum: ['text', 'image', 'video', 'videoNote', 'audio', 'voice', 'document', 'location', 'poll', 'product', 'system'],
      default: 'text',
    },
    content: { type: String, default: '' },

    /**
     * End-to-end encrypted payload. When `encrypted` is true, `content` is
     * ALWAYS the empty string — the readable text exists only as `enc.ct`,
     * sealed with the chat key, which the server never holds. `enc.v` records
     * which chat-key version sealed it, so a chat can rotate its key (on a
     * membership change) without orphaning history sealed under the old one.
     *
     * Consequences the rest of the codebase depends on:
     *  • the `content` text index can't see these, so server-side message search
     *    cannot work for encrypted chats — the client searches locally instead;
     *  • push/notification previews cannot show the text;
     *  • scheduled messages and business auto-replies are impossible (the server
     *    would have to compose or send them without a key).
     */
    encrypted: { type: Boolean, default: false },
    enc: {
      ct: { type: String }, // base64 AES-256-GCM ciphertext
      iv: { type: String }, // base64 96-bit nonce, unique per message
      v: { type: Number }, // chat-key version this was sealed with
    },

    attachments: [attachmentSchema],
    location: { lat: Number, lng: Number, label: String },
    // Live location: a 'location' message whose coordinates update in real time
    // until `expiresAt` (or the sharer stops it). `active` flips false on stop.
    liveLocation: {
      active: { type: Boolean, default: false },
      expiresAt: { type: Date },
    },
    poll: pollSchema,
    // Snapshot of a shared catalog product (so it renders even if the product is
    // later edited/deleted). `ref` points back to the live Product when it exists.
    product: {
      ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: String,
      description: String,
      price: Number,
      currency: String,
      image: String,
      link: String,
    },

    // Set when this message was sent automatically by a business auto-reply
    // ('greeting' | 'away') rather than typed by a person.
    autoReplyKind: { type: String },

    // Ephemeral messaging:
    // • expiresAt  — disappearing messages; a TTL index removes the doc after this time.
    // • viewOnce   — media that self-destructs once every recipient has opened it.
    expiresAt: { type: Date },
    viewOnce: { type: Boolean, default: false },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    reactions: [reactionSchema],
    readBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    editedAt: Date,
    isEdited: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }, // deleted for everyone
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // deleted for me

    systemEvent: { type: String }, // e.g. "member_added", "group_created"
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ content: 'text' });
// Media access control looks a file up by its attachment URL on every /uploads
// request — index it so that check is O(index) instead of a collection scan.
messageSchema.index({ 'attachments.url': 1 });
// Disappearing messages: MongoDB removes the document once expiresAt passes.
// (expireAfterSeconds:0 = expire exactly at the stored time.)
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// getStarred: `Message.find({ starredBy: req.user._id })` — without this, a
// large message collection means a full collection scan on every load.
// Compound (not just `starredBy`) because the starred list is always sorted
// newest-first: this way Mongo walks the index in order instead of loading
// every starred message and sorting them in memory.
messageSchema.index({ starredBy: 1, createdAt: -1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;

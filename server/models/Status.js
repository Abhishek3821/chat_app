import mongoose from 'mongoose';

/** Status / story — auto-expires 24h after creation via a TTL index. */
const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    content: { type: String, default: '' },
    media: { type: String, default: '' },
    background: { type: String, default: 'linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)' },

    viewers: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    replies: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: String,
        at: { type: Date, default: Date.now },
      },
    ],

    privacy: {
      type: { type: String, enum: ['everyone', 'contacts', 'selected', 'except'], default: 'contacts' },
      allow: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      except: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },

    expiresAt: { type: Date, default: () => Date.now() + 24 * 60 * 60 * 1000 },
  },
  { timestamps: true }
);

// TTL index — MongoDB removes the doc once expiresAt passes.
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Supports the status-feed query (`Status.find({ user: { $in: audience } }).sort({ createdAt: -1 })`)
// without an in-memory sort — the leading `user` field also serves plain
// per-user lookups, so this replaces the old single-field index.
statusSchema.index({ user: 1, createdAt: -1 });

const Status = mongoose.model('Status', statusSchema);
export default Status;

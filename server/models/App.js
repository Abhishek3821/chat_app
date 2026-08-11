import mongoose from 'mongoose';

/**
 * An "App" is a TENANT — one third-party SaaS product embedding ChatConnect.
 *
 * Why this exists rather than reusing Workspace or ApiKey:
 *   • Workspace is an in-product concept (a team of ChatConnect users, with a
 *     business profile and auto-replies). A tenant is the opposite direction —
 *     an outside product whose OWN users live here, isolated from ours.
 *   • ApiKey is owned by a `User`, so a key can never reach data its owner
 *     couldn't. That's exactly right for personal automation and exactly wrong
 *     for an embedding product, whose key must act for thousands of end users
 *     that no single ChatConnect user owns.
 *
 * Trust model, mirroring Stream/Sendbird/CometChat:
 *   appId      public. Safe in a frontend bundle. Identifies the tenant.
 *   secret     SERVER-SIDE ONLY. Hashed here, shown once at creation. The host's
 *              backend uses it to provision users and mint user tokens.
 *   userToken  short-lived, per-end-user, minted by the host's backend via the
 *              secret. This is what a browser actually holds.
 *
 * A browser therefore never sees anything that could act for another user.
 */

/** Every capability a tenant can be granted. Enforced server-side (see
 *  requireFeature) — a disabled feature is refused at the API, not merely
 *  hidden in the UI, so a tampered client gains nothing. */
export const APP_FEATURES = [
  'chat', // 1:1 messaging
  'groups', // group conversations
  'calls', // 1:1 audio calls
  'video', // video calls
  'meetings', // scheduled + instant meeting rooms
  'status', // stories/status
  'presence', // online/last-seen
  'typing', // typing indicators
  'receipts', // delivery + read receipts
  'reactions',
  'attachments', // media + document upload
  'e2ee', // end-to-end encryption (always on; flag kept for parity)
  'voiceNotes',
  'push', // web push to the tenant's end users
];

/** Sensible defaults for a new tenant: the messaging core on, the heavier and
 *  more opinionated surfaces off until deliberately enabled. */
const DEFAULT_FEATURES = ['chat', 'groups', 'presence', 'typing', 'receipts', 'reactions', 'attachments'];

const appSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Public tenant identifier, e.g. "app_7f3c9a2b4d1e". Safe to ship to browsers.
    appId: { type: String, required: true, unique: true, index: true },
    // SHA-256 of the secret. Never the secret itself — a database leak must not
    // hand over the ability to mint user tokens for a tenant.
    secretHash: { type: String, required: true, select: false },
    // Displayable prefix so an operator can tell two secrets apart in a list.
    secretPrefix: { type: String, required: true },
    secretRotatedAt: { type: Date },

    // The ChatConnect account that administers this tenant.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    features: {
      type: [String],
      default: DEFAULT_FEATURES,
      validate: {
        validator: (arr) => arr.every((f) => APP_FEATURES.includes(f)),
        message: 'Contains an unknown feature flag.',
      },
    },

    /* Origins allowed to use a user token from a browser. Empty = any origin,
       which is the right default for local development and for server-rendered
       hosts, but should be pinned before production. */
    allowedOrigins: { type: [String], default: [] },

    // Soft caps, so one tenant can't exhaust shared infrastructure.
    limits: {
      maxUsers: { type: Number, default: 10_000 },
      userTokenMinutes: { type: Number, default: 60 },
    },

    // Cheap counters for the admin console (avoids counting users on every view).
    usage: {
      users: { type: Number, default: 0 },
      tokensIssued: { type: Number, default: 0 },
      lastActivityAt: { type: Date },
    },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

appSchema.methods.hasFeature = function hasFeature(feature) {
  return this.active && (this.features || []).includes(feature);
};

export default mongoose.model('App', appSchema);

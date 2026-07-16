import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * A Workspace is a tenant/organisation used for org management (roles, invites,
 * member admin, business profile). NOTE: users are globally reachable by exact
 * username/email across workspaces (WhatsApp-style), so the workspace is an
 * organisational layer, not a hard contact wall — partial member search stays
 * scoped to the org so a company roster is never a browsable global directory.
 *
 *   - The person who signs up (without an invite) creates a workspace and becomes
 *     its `owner` (workspaceRole 'owner').
 *   - Others join via the workspace's `inviteCode` and become 'member'.
 *   - The platform super-admin (User.role === 'admin') can see ALL workspaces.
 */
const businessProfileSchema = new mongoose.Schema(
  {
    category: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 1000 },
    hours: { type: String, default: '' }, // free-text, e.g. "Mon–Fri 9–5"
    address: { type: String, default: '' },
    website: { type: String, default: '' },
    email: { type: String, default: '' },
    verified: { type: Boolean, default: false }, // platform-admin-granted badge
  },
  { _id: false }
);

// WhatsApp-Business auto-replies. `greeting` fires once per chat on a customer's
// first message; `away` fires (throttled) when a customer messages outside the
// configured business hours [startHour, endHour) in 24h local time.
const autoRepliesSchema = new mongoose.Schema(
  {
    greeting: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: '', maxlength: 1000 },
    },
    away: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: '', maxlength: 1000 },
      startHour: { type: Number, default: 9, min: 0, max: 23 },
      endHour: { type: Number, default: 18, min: 0, max: 23 },
    },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // 'team' = a company/organisation workspace. 'personal' = the single shared
    // consumer space that all Personal-account users live in.
    type: { type: String, enum: ['team', 'personal'], default: 'team', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    // Anyone with this code can join the workspace. Rotatable by the owner/admin.
    inviteCode: { type: String, required: true, unique: true, index: true },
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
    // WhatsApp-Business-style storefront profile for team workspaces.
    businessProfile: { type: businessProfileSchema, default: () => ({}) },
    autoReplies: { type: autoRepliesSchema, default: () => ({}) },
    settings: { type: Object, default: {} },
  },
  { timestamps: true }
);

/** A short, URL-safe, unguessable invite code. */
export function generateInviteCode() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, ~72 bits
}

/** Turn a name into a unique-ish slug base (uniqueness enforced by the caller). */
export function slugifyName(name) {
  return (
    String(name || 'workspace')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'workspace'
  );
}

const Workspace = mongoose.model('Workspace', workspaceSchema);
export default Workspace;

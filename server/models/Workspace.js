import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * A Workspace is a tenant/organisation. Every user belongs to exactly one
 * workspace and can only discover, contact, chat, call and meet OTHER users in
 * the same workspace — this is the data-isolation boundary for the SaaS.
 *
 *   - The person who signs up (without an invite) creates a workspace and becomes
 *     its `owner` (workspaceRole 'owner').
 *   - Others join via the workspace's `inviteCode` and become 'member'.
 *   - The platform super-admin (User.role === 'admin') can see ALL workspaces.
 */
const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    // Anyone with this code can join the workspace. Rotatable by the owner/admin.
    inviteCode: { type: String, required: true, unique: true, index: true },
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
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

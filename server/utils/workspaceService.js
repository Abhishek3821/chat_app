import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Workspace, { generateInviteCode, slugifyName } from '../models/Workspace.js';
import { ApiError } from './asyncHandler.js';

/** Reserve a slug that isn't taken yet (adds a short suffix on collision). */
async function uniqueSlug(base) {
  let slug = slugifyName(base);
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await Workspace.exists({ slug }))) return slug;
    slug = `${slugifyName(base)}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return `${slugifyName(base)}-${Date.now().toString(36)}`;
}

async function uniqueInviteCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = generateInviteCode();
    // eslint-disable-next-line no-await-in-loop
    if (!(await Workspace.exists({ inviteCode: code }))) return code;
  }
  return `${generateInviteCode()}${Date.now().toString(36)}`;
}

/** Create a workspace owned by `user` and attach the user as its owner. Returns the workspace. */
export async function createWorkspaceForUser(user, name) {
  const wsName = (typeof name === 'string' && name.trim()) || `${user.name}'s workspace`;
  const ws = await Workspace.create({
    name: wsName.slice(0, 80),
    slug: await uniqueSlug(wsName),
    owner: user._id,
    inviteCode: await uniqueInviteCode(),
    plan: 'free',
  });
  user.workspace = ws._id;
  user.workspaceRole = 'owner';
  await user.save({ validateBeforeSave: false });
  return ws;
}

const PERSONAL_SLUG = 'personal-space';

/**
 * Attach `user` to the single shared "Personal" space — the consumer tenant that
 * every Personal-account user joins. Because it's one workspace, personal users
 * can discover/contact each OTHER (subject to the consent + exact-match rules),
 * but the tenant boundary still keeps them fully separate from every team
 * workspace ("don't mix them"). Get-or-create is race-safe on the unique slug.
 */
export async function joinPersonalSpace(user) {
  let ws = await Workspace.findOne({ slug: PERSONAL_SLUG });
  if (!ws) {
    try {
      ws = await Workspace.create({
        name: 'Personal',
        slug: PERSONAL_SLUG,
        type: 'personal',
        owner: user._id, // nominal — the shared space has no real owner/admin
        inviteCode: await uniqueInviteCode(),
        plan: 'free',
      });
    } catch (err) {
      if (err?.code === 11000) ws = await Workspace.findOne({ slug: PERSONAL_SLUG });
      else throw err;
    }
  }
  user.workspace = ws._id;
  user.workspaceRole = 'member';
  await user.save({ validateBeforeSave: false });
  return ws;
}

/** Attach `user` to the workspace identified by an invite code (as a member). */
export async function joinWorkspaceByCode(user, code) {
  const ws = await Workspace.findOne({ inviteCode: String(code || '').trim() });
  if (!ws) throw new ApiError(400, 'That invite code is invalid or has expired.');
  user.workspace = ws._id;
  user.workspaceRole = 'member';
  await user.save({ validateBeforeSave: false });
  return ws;
}

/**
 * Give a freshly-created user a workspace: join by invite code if provided,
 * otherwise create their own. Never throws for a missing code — only for a
 * present-but-invalid one (handled in joinWorkspaceByCode).
 */
export async function provisionWorkspace(user, { inviteCode, workspaceName } = {}) {
  if (inviteCode && String(inviteCode).trim()) return joinWorkspaceByCode(user, inviteCode);
  return createWorkspaceForUser(user, workspaceName);
}

/**
 * One-time (idempotent) migration for pre-multi-tenant data: ensure a single
 * "Default" workspace exists and every user/chat that predates workspaces is
 * attached to it. Safe to run on every boot — it only touches docs missing a
 * workspace. Returns a small summary for logging.
 */
export async function ensureWorkspaces() {
  const orphanUserCount = await User.countDocuments({ workspace: { $in: [null, undefined] } });
  const orphanChatCount = await Chat.countDocuments({ workspace: { $in: [null, undefined] } }).catch(() => 0);
  if (orphanUserCount === 0 && orphanChatCount === 0) return { migrated: false };

  // Pick an owner for the default workspace: a super-admin if one exists, else anyone.
  const owner = (await User.findOne({ role: 'admin' }).select('_id name')) || (await User.findOne().select('_id name'));

  let ws = await Workspace.findOne({ slug: 'default' });
  if (!ws) {
    ws = await Workspace.create({
      name: 'Default Workspace',
      slug: 'default',
      owner: owner?._id,
      inviteCode: await uniqueInviteCode(),
      plan: 'business', // the legacy/default org is unrestricted
    });
  }

  const users = await User.updateMany(
    { workspace: { $in: [null, undefined] } },
    { $set: { workspace: ws._id, workspaceRole: 'member' } }
  );
  // The owner of the default workspace becomes its 'owner'.
  if (owner?._id) {
    await User.updateOne({ _id: owner._id }, { $set: { workspace: ws._id, workspaceRole: 'owner' } });
  }
  const chats = await Chat.updateMany(
    { workspace: { $in: [null, undefined] } },
    { $set: { workspace: ws._id } }
  ).catch(() => ({ modifiedCount: 0 }));

  return { migrated: true, workspace: ws.slug, users: users.modifiedCount || 0, chats: chats.modifiedCount || 0 };
}

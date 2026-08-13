import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import { joinPersonalSpace, createWorkspaceForUser } from './workspaceService.js';

/**
 * The single super admin, provisioned from the environment on every boot.
 *
 * Point MONGO_URI at an empty database and there is no way in: signup only ever
 * creates a plain `user`, and the only route to `role: 'admin'` was running
 * `node utils/createAdmin.js` by hand. So a fresh database — a new cluster, a
 * restored backup, a colleague cloning the repo — silently had no admin at all
 * and no obvious way to notice. This closes that: the admin is declared in
 * `.env` and reconciled at startup, so the database always matches the config.
 *
 * SINGLE by construction: exactly one account may hold `role: 'admin'`. Anyone
 * else found holding it is demoted to `user` on boot, which is what makes
 * "there is one super admin" a property the system maintains rather than a
 * convention people remember.
 *
 * `.env` WINS — including the password. If SUPER_ADMIN_PASSWORD no longer
 * matches what's stored, the stored hash is replaced at startup, so the file is
 * the single source of truth: edit it, restart, those are the credentials. Two
 * consequences that follow from that and are not bugs:
 *   • a password changed in Settings is reverted on the next restart — and on a
 *     hosted deploy every deploy IS a restart;
 *   • a genuine change bumps `tokenVersion`, signing the admin out of every
 *     device, which is the right move for a credential rotation.
 * Hence the bcrypt compare before writing: an UNCHANGED password must not
 * re-hash and revoke sessions on every single boot.
 */

const EMAIL = () => (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = () => process.env.SUPER_ADMIN_PASSWORD || '';
const NAME = () => (process.env.SUPER_ADMIN_NAME || 'Super Admin').trim().slice(0, 60);

/** A username derived from the email, uniquified — usernames are globally unique. */
async function uniqueUsername(email) {
  const base = (email.split('@')[0] || 'admin').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24) || 'admin';
  if (!(await User.exists({ username: base }))) return base;
  for (let i = 0; i < 6; i += 1) {
    const candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

/**
 * Reconcile the configured super admin with the database. Safe to run on every
 * boot and never throws — a failure here must not stop the API from serving.
 *
 * @returns {Promise<{status: string, email?: string, demoted?: number}>}
 */
export async function ensureSuperAdmin() {
  const email = EMAIL();
  const password = PASSWORD();

  if (!email) return { status: 'unconfigured' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { status: 'invalid-email', email };

  // +password: it's `select: false` on the schema, and the sync below has to
  // compare against the stored hash.
  let admin = await User.findOne({ email }).select('+password');

  if (!admin) {
    // Creating requires a password; promoting an existing account does not.
    if (password.length < 8) return { status: 'no-password', email };
    const username = await uniqueUsername(email);
    admin = await User.create({
      name: NAME(),
      username,
      email,
      password, // hashed by the model's pre-save hook
      role: 'admin',
      isVerified: true,
      accountStatus: 'active',
      avatar: `https://api.dicebear.com/9.x/glass/svg?seed=${username}`,
    });
    /* A user with no workspace can't reach anyone — search, contacts and groups
       all key off it. createAdmin.js has always skipped this and left the admin
       stranded until the next boot's ensureWorkspaces() swept them up. */
    await attachWorkspace(admin);
    return { status: 'created', email, demoted: await demoteOthers(admin._id) };
  }

  // Already there: make sure it actually holds the powers, and can log in.
  const fixes = [];
  if (admin.role !== 'admin') { admin.role = 'admin'; fixes.push('role'); }
  if (admin.accountStatus !== 'active') { admin.accountStatus = 'active'; fixes.push('status'); }
  if (!admin.isVerified) { admin.isVerified = true; fixes.push('verified'); }

  /* Password sync — `.env` is authoritative. Only writes on a REAL difference:
     re-hashing an identical password every boot would bump tokenVersion and log
     the admin out on each restart for no reason. A blank/short SUPER_ADMIN_
     PASSWORD is treated as "not specified" rather than as a reset, so an
     accidentally-cleared line can't lock the owner out of their own admin. */
  if (password.length >= 8) {
    const same = admin.password ? await bcrypt.compare(password, admin.password) : false;
    if (!same) {
      admin.password = password; // re-hashed by the model's pre-save hook
      admin.tokenVersion = (admin.tokenVersion || 0) + 1; // sign out every old session
      fixes.push('password');
    }
  }
  if (fixes.length) await admin.save({ validateBeforeSave: false });
  if (!admin.workspace) await attachWorkspace(admin);

  return {
    status: fixes.length ? 'repaired' : 'ok',
    email,
    fixes,
    demoted: await demoteOthers(admin._id),
  };
}

/** Put a fresh admin in a workspace so they can actually use the product. */
async function attachWorkspace(user) {
  try {
    // Prefer the shared Personal space when it exists (that's where first-party
    // users live); otherwise give them their own.
    const personal = await Workspace.findOne({ slug: 'personal-space' }).select('_id');
    if (personal) await joinPersonalSpace(user);
    else await createWorkspaceForUser(user, `${NAME()}'s workspace`);
  } catch {
    /* best-effort — ensureWorkspaces() will sweep them up on the next boot */
  }
}

/** Strip `role: 'admin'` from everyone except the configured account. */
async function demoteOthers(keepId) {
  const res = await User.updateMany({ role: 'admin', _id: { $ne: keepId } }, { $set: { role: 'user' } });
  return res.modifiedCount || 0;
}

/** One-line boot report, so a misconfiguration is visible in the logs. */
export function describeSuperAdmin(result) {
  switch (result.status) {
    case 'created':
      return `👑 Super admin created from .env: ${result.email}${result.demoted ? ` (demoted ${result.demoted} other admin(s))` : ''}`;
    case 'repaired': {
      const pw = result.fixes.includes('password')
        ? ' — password reset from .env, all previous admin sessions signed out'
        : '';
      return `👑 Super admin ${result.email} repaired (${result.fixes.join(', ')})${result.demoted ? `, demoted ${result.demoted} other admin(s)` : ''}${pw}`;
    }
    case 'ok':
      return result.demoted
        ? `👑 Super admin ${result.email} — demoted ${result.demoted} other admin(s) (only one is allowed)`
        : `👑 Super admin ${result.email} ✓`;
    case 'no-password':
      return `⚠️  SUPER_ADMIN_EMAIL is set (${result.email}) but no account exists and SUPER_ADMIN_PASSWORD is missing or under 8 characters — no admin was created.`;
    case 'invalid-email':
      return `⚠️  SUPER_ADMIN_EMAIL is not a valid address (${result.email}) — no admin was created.`;
    default:
      return '⚠️  No SUPER_ADMIN_EMAIL configured — this database has no guaranteed admin. Set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD in server/.env.';
  }
}

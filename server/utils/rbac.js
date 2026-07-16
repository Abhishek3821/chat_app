import { ApiError } from './asyncHandler.js';

/**
 * Central RBAC policy — the SINGLE source of truth for "who can do what". Three
 * role dimensions:
 *   • platform   — User.role ('admin' = super-admin, everything)
 *   • workspace  — User.workspaceRole ('owner' | 'admin' | 'member')
 *   • group      — per-chat participant.role ('owner' | 'admin' | 'member')
 * Controllers/routes ask via can()/workspaceCan()/groupCan() or the authorize()
 * middleware instead of hard-coding `role === '...'` checks.
 */
export const PERMISSIONS = {
  PLATFORM_ADMIN: 'platform:admin', // admin dashboard, API keys, moderation

  WORKSPACE_SETTINGS: 'workspace:settings', // rename, etc.
  WORKSPACE_INVITE: 'workspace:invite', // rotate/view invite link
  WORKSPACE_TRANSFER: 'workspace:transfer', // transfer ownership (owner only)
  MEMBERS_READ: 'members:read', // see the roster
  MEMBERS_MANAGE: 'members:manage', // suspend / remove / change role

  GROUP_MANAGE: 'group:manage', // rename, description, avatar, policy
  GROUP_MEMBERS: 'group:members', // add / remove / change member role
  GROUP_POST: 'group:post', // send messages
};

const WORKSPACE_ROLE_PERMISSIONS = {
  owner: [
    PERMISSIONS.WORKSPACE_SETTINGS,
    PERMISSIONS.WORKSPACE_INVITE,
    PERMISSIONS.WORKSPACE_TRANSFER,
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_MANAGE,
  ],
  admin: [
    PERMISSIONS.WORKSPACE_SETTINGS,
    PERMISSIONS.WORKSPACE_INVITE,
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_MANAGE,
  ],
  member: [PERMISSIONS.MEMBERS_READ],
};

const GROUP_ROLE_PERMISSIONS = {
  owner: [PERMISSIONS.GROUP_MANAGE, PERMISSIONS.GROUP_MEMBERS, PERMISSIONS.GROUP_POST],
  admin: [PERMISSIONS.GROUP_MANAGE, PERMISSIONS.GROUP_MEMBERS, PERMISSIONS.GROUP_POST],
  member: [PERMISSIONS.GROUP_POST],
};

/** Platform + workspace permission check for a user. Platform admin has everything. */
export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true; // platform super-admin override
  if (permission === PERMISSIONS.PLATFORM_ADMIN) return false;
  return (WORKSPACE_ROLE_PERMISSIONS[user.workspaceRole] || []).includes(permission);
}

export const workspaceCan = can; // alias for readability at call sites

/** Group permission check, given a participant's per-chat role. */
export function groupCan(role, permission) {
  return (GROUP_ROLE_PERMISSIONS[role] || []).includes(permission);
}

/** Route middleware: require a platform/workspace permission (use after `protect`). */
export function authorize(permission) {
  return (req, res, next) =>
    can(req.user, permission)
      ? next()
      : next(new ApiError(403, 'You do not have permission to perform this action.'));
}

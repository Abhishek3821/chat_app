# ChatKonect Role-Based Access Developer Guide

Updated: 15 October 2026 | Audience: application developers, backend engineers and QA

This document defines the current authorization implementation, not a proposed enterprise permission system. It covers platform, workspace and group roles; session and guest gates; resource ownership; meeting authority; app capabilities; integration credentials; API mutation flows; frontend behavior; known gaps and acceptance checks. Examples use placeholders only. Source inspection informs the guide; no claim is made that every deployment path has been penetration-tested.

## 1. Role dimensions and authorization model

Role names are reused at different scopes. A workspace admin is not a platform admin. A group owner does not own the workspace. A meeting host is identified by the meeting's host user ID, not by a role name. Access also requires authentication, account status, session validity, resource membership and, on selected routers, an enabled embedded App capability.

| Dimension | Stored field | Values / meaning |
|---|---|---|
| Platform | User.role | user or admin; admin is the platform super admin |
| Workspace | User.workspaceRole | owner, admin, member, guest |
| Workspace scope | User.workspace | One current organization/shared Personal space |
| Group | Chat.participants[].role | owner, admin or member per chat |
| Meeting | Meeting.host / participants | Host authority and invited/link participation |
| Embedded tenant | User.app | Separate App tenant identity |
| Account access | User.accountStatus | active, suspended or banned |
| Session generation | User.tokenVersion | Invalidates older access tokens |
| Guest scope | guestAllowedChats, guestExpiresAt | Selected groups and expiry |

For example, a user can be platform user, workspace admin, group member in Group A and group owner in Group B. Only the group role can grant normal management of Group A. Being workspace admin does not automatically make that user a host in someone else's meeting.

The central permission definitions live in server/utils/rbac.js. Some endpoints still use direct role checks or resource ownership rather than these helpers. Evaluate the complete route/controller path; the permission table alone is not a guarantee that every route uses identical policy.

## 2. Authentication gates before role checks

The protect middleware accepts a Bearer access token or supported first-party cookie. It verifies HS256 through verifyToken, rejects scoped passes as general sessions, requires sid, loads the current User and Session, rejects suspended/banned accounts, applies guest limits, checks tokenVersion and validates session expiry/revocation/user ownership. Role decisions use the database user, not a role supplied in the request body or trusted only from an old JWT.

Socket.IO independently authenticates its handshake with auth.token or a Bearer header. It verifies account status, tokenVersion and tracked session, and refuses workspaceRole guest. It copies identity into socket.data. Existing per-meeting host flags are cached at room join; handshake validation does not imply continuous revalidation on every event.

The normal access token payload includes id, role, tokenVersion, sid and type access; default access lifetime is one hour unless configured. Media, meet-admit and meet-password passes have narrower scopes and cannot log into the general HTTP/socket surface. The meeting admission pass lasts 15 minutes and the password pass four hours. Keep tokens in their intended flow; a room link is not a credential.

HTTP 401 means authentication/session failure. HTTP 403 means an authenticated caller is denied by account/guest/capability/authorization rules. A controller may use 404 for an out-of-scope target and 400 for a protected owner/self target. Do not force all failures into 403 in a custom client.

## 3. Central permission registry

| Constant | Permission string | Main meaning |
|---|---|---|
| PLATFORM_ADMIN | platform:admin | Platform moderation/admin routes |
| WORKSPACE_SETTINGS | workspace:settings | Workspace and business configuration |
| WORKSPACE_INVITE | workspace:invite | Workspace invite management |
| WORKSPACE_TRANSFER | workspace:transfer | Ownership transfer |
| MEMBERS_READ | members:read | Workspace roster permission definition |
| MEMBERS_MANAGE | members:manage | Member role/access/removal |
| GROUP_MANAGE | group:manage | Group metadata/policy administration |
| GROUP_MEMBERS | group:members | Group membership permission definition |
| GROUP_POST | group:post | Group posting permission definition |

can(user, permission) returns false without a user. If User.role is admin, it returns true before checking the permission value. For other users, platform:admin is denied and the workspace role's static permission array is checked. workspaceCan is an alias of can, not a different tenant-aware function.

groupCan(role, permission) looks only at the provided per-group role and its static array. It does not inspect User.role, workspaceRole or resource membership by itself. authorize(permission) is Express middleware that uses can and returns 403 when denied; it must follow protect.

There is no stored custom-role definition, permissions editor, per-member permission override, dynamic policy service or public permission-discovery endpoint in this module. To add a permission, update the constants, static matrices, route/controller use, frontend display and tests together.

## 4. Workspace permission matrix

The following reflects the helper definitions. It assumes a valid active authenticated account; guest protect restrictions can deny a route before these values are considered.

| Workspace permission | Owner | Admin | Member / guest |
|---|---|---|---|
| workspace:settings | Yes | Yes | No / No |
| workspace:invite | Yes | Yes | No / No |
| workspace:transfer | Yes | No | No / No |
| members:read | Yes | Yes | Yes / No |
| members:manage | Yes | Yes | No / No |
| platform:admin | No | No | No / No |

Platform User.role admin overrides every can/workspaceCan check regardless of workspaceRole. The table does not remove resource scoping: an admin passing a workspace permission still accesses the workspace selected by the controller, often their own current workspace. A platform override is not automatic arbitrary-workspace routing.

members:read is defined but getMyWorkspace does not call authorize(MEMBERS_READ). It uses authentication, current workspace and personal/team response shaping. Group-members/post permissions are similarly defined but many current call sites use group:manage or custom posting logic instead of those exact constants.

### Workspace tools use an additional policy

workspaceToolsController requires a team workspace and rejects guests. Its manager helper is a direct owner/admin workspaceRole test, so it does not include the central platform-role override. This distinction matters for activity and guests.

| Team action | Owner/admin | Ordinary team member | Guest/personal |
|---|---|---|---|
| List/reply/manage team inbox | Yes | Yes | No |
| Add internal inbox notes | Yes | Yes | No |
| Create/edit any team task | Yes | Yes | No |
| Read latest activity | Yes | No | No |
| List/create/revoke guests | Yes | No | No |
| Change business profile/catalog definitions | Central settings permission | No | Normally no |
| Use labels/quick replies in accessible chats | Yes | Yes | Guest route denied |

No separate agent, supervisor or task-assignee role exists. Assignment does not restrict access to a task or inbox thread. Catalog/agent controllers use the central settings permission and workspace scoping, but do not universally test type team; do not infer a uniform team-type gate across every business endpoint.

## 5. Workspace role and ownership mutation contracts

All paths below require a valid user session and operate under `/api/workspaces`. The me segment uses the caller's current workspace; the body cannot select a different team.

| Method / suffix | Body | Main restrictions |
|---|---|---|
| PATCH /me/members/:userId/role | role: admin or member | Manager; same workspace; not owner/guest |
| PATCH /me/members/:userId/status | status: active or suspended | Manager; not self/owner/platform-banned |
| DELETE /me/members/:userId | None | Manager; not self/owner; same workspace |
| POST /me/transfer | userId | Transfer permission; active non-guest other member |
| PATCH /me | name/profile/autoReplies | Workspace settings permission |
| POST /me/invite/rotate | None | Workspace invite permission |

```js
await api.patch('/workspaces/me/members/USER_ID/role', {
  role: 'admin'
});
await api.patch('/workspaces/me/members/USER_ID/status', {
  status: 'suspended'
});
await api.post('/workspaces/me/transfer', {
  userId: 'ACTIVE_TARGET_USER_ID'
});
```

Use admin only to change workspaceRole through this route; it does not set User.role. The controller accepts no owner value here. The owner transfers through the separate endpoint, which promotes the target, demotes the requester to admin and changes Workspace.owner. It uses multiple sequential writes without a transaction. A platform admin can pass workspace:transfer even when not the actual current owner, so review ownership invariants if using this override.

Workspace admins can promote/demote peer admins, not just members. A direct self-role request is not explicitly rejected by the role handler, although the Settings UI hides self-actions. Status/removal have explicit self checks. Suspended/banned accounts cannot use protect; role changes alone do not increment tokenVersion, but future HTTP checks load the new workspaceRole from the database.

Removal is organizational ejection, not deletion. It pulls tagged chat participation, cleans selected contact references, provisions a new owned team workspace and increments tokenVersion. The user's platform role is not converted by that operation. See the workspace guide for mixed-workspace chat and multi-record cleanup limits.

## 6. Platform super admin and account moderation

Platform adminOnly is based on can(user, PLATFORM_ADMIN). Workspace owners/admins do not qualify merely by their workspaceRole. `/api/admin` uses protect then adminOnly for all routes.

| Method | Path | Purpose |
|---|---|---|
| GET | /api/admin/stats | Platform totals/activity |
| GET | /api/admin/users | Platform user list/search |
| PATCH | /api/admin/users/:id/status | active/suspended/banned moderation |
| DELETE | /api/admin/users/:id | Delete account and associated data |
| GET | /api/admin/reports | Moderation reports |
| PATCH | /api/admin/reports/:id | Update report status |

The platform status body uses accountStatus, whereas workspace status uses status. Platform moderation refuses suspending/banning the acting admin and refuses deleting their own account. Suspending/banning increments tokenVersion. Workspace managers cannot clear a banned account through their member-status endpoint.

The boot utility reconciles a single super admin from SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD and optional SUPER_ADMIN_NAME. When configured and successfully reconciled, other platform admins are demoted to user. New creation requires a password of at least eight characters. Existing matching credentials are not rehashed on every boot. A changed configured password replaces the stored password and revokes old versions; a Settings password change can be overwritten at the next configured boot. No environment values belong in a handoff document or frontend bundle.

Signup explicitly sets platform role user. General profile update uses a whitelist rather than copying role/workspaceRole from the body. There is no normal user-facing promote-to-platform-admin endpoint in these routes. Environment provisioning is distinct from workspace member promotion.

## 7. Group roles and posting policy

| Group permission | Owner | Admin | Member |
|---|---|---|---|
| group:manage | Yes | Yes | No |
| group:members | Yes | Yes | No |
| group:post | Yes | Yes | Yes |

Group role is stored beside each Chat participant, not on User. A platform super admin has no implicit bypass through groupCan. requireGroupPerm finds the caller's actual participant row and checks its role, normally against group:manage. Workspace admin status alone is insufficient.

Under `/api/groups`, creating a group makes its creator owner. PATCH `/:id` edits name, description, avatar and messagingPolicy with management permission. POST `/:id/members`, DELETE `/:id/members/:userId` and PATCH `/:id/members/:userId/role` use the management gate. Member role updates accept admin/member only; the owner cannot be demoted this way or removed through the remove-member route. A manager can change another admin's role; no strictly owner-only promotion model is enforced.

POST `/:id/leave` requires actual membership. When the owner leaves, the first remaining participant is promoted if no owner remains; an empty group is deleted. There is no explicit group transfer-owner endpoint in this router. POST `/join/:inviteCode` is a group invitation join and is unrelated to workspace signup invitations.

messagingPolicy all permits normal member posting; admins restricts posting to permitted group management roles in the send/poll logic. Pin management also uses group:manage; either participant can pin in a direct chat where there is no group hierarchy. Group creation/addition additionally resolves tenant/consent rules; a matching group role is not a bypass of user identity reachability or account status.

Group role mutation invalidates affected chat-list caches and emits group-updated; other membership paths emit chat-updated as appropriate. Refresh participant roles from the server rather than deriving them from workspace roles. Product sharing and alternate send endpoints should be reviewed individually for consistent policy enforcement rather than assuming every Message.create call passes through the normal send handler.

## 8. Meeting authority is resource ownership

The meeting host is Meeting.host. Host checks compare the authenticated user ID to that reference. A workspace owner or platform admin is not automatically the host. Meeting participants may be explicitly invited or registered through a shared link using viaLink true; link registration is not an admission bypass.

Hosts can edit/cancel/invite, read attendance reports, create/end breakouts, start/close polls, answer Q&A and moderate a live room. In-room moderation requires the caller to be in the socket room and have its host flag. Attendees can vote, ask/upvote, react, raise hands and use chat/screen share subject to policy. Notes are accessible to the host or historical recorded attendees, not just current live participants.

Ask-to-join, password, locked room, host presence, breakout assignment and mesh capacity are additional gates. Non-host users may need both passwordPass and admission pass. Host mute/remove are client/socket coordination rather than a guaranteed SFU server ban. The separate meeting guide contains full endpoints, events, token rules and current limits.

## 9. Guest is a restricted access class

Although the User workspaceRole enum contains guest, no guest entry exists in the central workspace permission arrays. Guest access is defined primarily by protect's explicit route allowlist, expiry fields, per-chat checks and the separate portal.

Allowed guest HTTP surface is GET auth/me, GET chats, GET chats/:id, GET messages/:chatId, POST messages and POST auth/logout. The actual paths include /api and match the middleware's patterns. For all other protected routes, a guest receives 403 before normal role handling. Expired guests cannot use the allowed routes except the special logout handling; suspended guests are rejected by account status. General login/refresh also checks guest expiry.

The chat list requires assigned IDs, matching workspace, group type and membership. Message reads/sends also require allowed groups; sends are text-only and reject attachment bodies, replies, mentions, forwarded content and locations. Guests cannot open Socket.IO, meetings, calls, workspace tools, catalog editing, uploads or general contact discovery. They poll messages in GuestPortal instead of receiving normal socket events.

Managers create guest links for 1-20 team groups, 1-90 days access or no access expiry. Signup links are one-use and always expire seven days after issue; access duration begins on claim. Revocation suspends, increments tokenVersion and pulls memberships. A minute-based background sweep performs similar expiry cleanup. Do not convert guest to member/admin with the generic workspace role route or promise a complete contractor role editor.

## 10. Resource scoping, App capabilities and credentials

A permission answers whether a type of action is allowed; resource scoping answers which record the user can act on. Workspace member updates filter both target _id and req.user.workspace. Tasks and inbox management filter current workspace. Group actions require participant identity. Customer inbox detail/reply uses either team workspace or owning-customer identity. A manager must not receive unrestricted Model.findById authority merely because can returned true.

tenantScope(user) is `{ app: user.app || null }`. It distinguishes embedded App tenants and first-party users. It is separate from workspace scope and applied at selected identity discovery/resolution points. Exact user search may cross workspace boundaries inside the tenant; partial directory search is limited to the caller's team. Consent/contact, blocking and group invitation rules add further constraints. Do not equate workspace equality with consent, or app equality with group membership.

requireFeature(feature) checks the App's granted capabilities for embedded users; first-party users bypass it. Meetings, groups, calls and other selected routers use it. It is not a custom user role or a billing plan check. Workspace tools routes currently use protect without a matching generic workspace feature middleware. Socket handshake/admission does not consistently reproduce every REST feature/tenant gate; review boundary-sensitive integrations.

| Credential | Identity / intended use | Not equivalent to |
|---|---|---|
| User access token | End-user HTTP/socket session | Admin role or room admission |
| App secret plus App ID | Backend provisioning/token minting for a tenant | Browser login token |
| Personal X-API-Key | Acts as its owner with required scopes on v1 routes | Complete workspace/session API |
| Meet admission/password pass | Narrow user+meeting proof | General access token |
| LiveKit token | Authorized SFU media room grants | ChatKonect user session |

Personal API-key middleware checks active key/owner and required scopes, then sets req.user to the owner. It does not run the complete protect tracked-session/guest allowlist pipeline. App management `/api/apps` scopes records to the caller as owner, except platform admins see all; frontend platform-page visibility is a separate UI choice. Do not document all app management as server adminOnly.

## 11. Frontend integration and server middleware examples

The frontend Settings workspace section uses myRole owner/admin to show manager controls and hides owner/self row mutations. WorkspacePage exposes inbox/tasks to normal team members and guests/activity only to owner/admin. A personal account gets a team-tools-unavailable screen. ProtectedRoute sends guest users to /guest. Admin pages use platform role. Group controls use participant roles; meeting controls use host identity.

These conditions are display behavior, not enforcement. A custom frontend should handle server denials, reload role/user state after mutations, clear state on account changes and never allow a selected dropdown to directly write arbitrary User fields. No `/permissions` endpoint currently exists; derive UI access from server-provided user, myRole, resource membership and canManage response values, while preserving the backend as authority.

```js
import { protect } from '../middleware/auth.js';
import { authorize, PERMISSIONS } from '../utils/rbac.js';

// Pattern for a NEW endpoint; not an existing route declaration.
router.patch('/me/example-setting',
  protect,
  authorize(PERMISSIONS.WORKSPACE_SETTINGS),
  asyncHandler(async (req, res) => {
    const workspace = await Workspace.findById(req.user.workspace);
    if (!workspace) throw new ApiError(404, 'No workspace.');
    // Validate a narrow allowed field; never copy req.body wholesale.
    res.json({ success: true });
  })
);
```

The example assumes asyncHandler, ApiError and Workspace imports. For a team-only endpoint, additionally enforce actual workspace type and guest policy. For a group endpoint, load/find the caller's participant and use groupCan; do not use can with GROUP_MANAGE and expect workspace roles to map correctly. For meeting operations compare Meeting.host or require the intended attendee relationship. Use enums/constants and keep new denial behavior tested.

## 12. Current policy mismatches and implementation limits

These items document source behavior that a developer should resolve deliberately when extending authorization; the documentation task does not change access policy.

- Central can grants platform admin every permission string, even an unknown one; groupCan has no platform override. Validate new permission names and choose scope explicitly.
- Workspace tools use direct workspaceRole checks, while core workspace/catalog/agent paths use central helpers. A platform admin can be authorized by one and denied by another; current UI can also hide actions the helper would allow.
- Role changes do not emit a dedicated global permission-refresh event. HTTP loads current roles, but UI stores and existing socket cached host/session state may remain stale.
- tokenVersion revocation is checked on future requests and socket handshakes; it does not by itself continuously remove established sockets from rooms. Suspend/remove paths do not uniformly disconnect them.
- Workspace role change does not explicitly reject self-demotion; UI self-action hiding is narrower than the API. Peer admins can manage each other. These are current rules, not an owner-only administrative hierarchy.
- Workspace transfer is nontransactional and demotes the requester. A platform override by a non-owner can leave ownership invariants requiring reconciliation. Normal owner transfers should be checked for partial-write failure too.
- Limited guest safety depends on route allowlist plus controller checks; alternative authentication middleware such as personal API-key paths must be assessed separately rather than inheriting that guarantee by assumption.
- Customer inbox creation/raw thread return may expose internal notes after a subsequent customer append, despite detail-handler redaction. Cross-App external workspace/catalog paths lack universal tenant checks.
- Meeting code access and socket admission do not universally enforce same-App ownership/capability in the current implementation. Anonymous Q&A still exposes stored askedBy in object payloads. See the meeting guide before promising tenant/privacy guarantees.
- Group role policy is not automatically applied to every alternate message-producing endpoint; review product-share and future background send paths. MEMBERS_READ, GROUP_MEMBERS and GROUP_POST definitions are not uniformly used at call sites.
- No custom roles, permissions assignment UI, per-field ACL, workspace role history rollback, co-host permission role, SSO role mapping or automatic organization-domain enrollment is provided by the inspected policy code.

## 13. Acceptance tests and operational checks

1. Matrix-test can for null user, platform user/admin and owner/admin/member/guest/unknown workspaceRole across all nine permission strings. Include an unknown permission to expose current platform-admin behavior.
2. Matrix-test groupCan independently for owner/admin/member/missing role; verify workspace/platform roles alone do not grant group administration.
3. Test protected HTTP and socket handshake with valid, expired, revoked, missing-sid, wrong-user session and scoped-pass tokens. Verify suspended/banned state and tokenVersion changes.
4. Create team owner/admin/member/guest plus an unrelated team member. Verify every workspace mutation's same-workspace target filters and protected owner/self cases.
5. Promote/demote peer admins; compare hidden self controls with direct self-role request. Check fresh HTTP authorization and stale UI after changes.
6. Transfer as owner to active member/admin, reject self/guest/suspended/outsider, test platform override separately and verify Workspace.owner plus all user roles after failures.
7. Test pause/resume and removal with old tokens, active sockets, reconnects, tagged chats, mixed-workspace chats and new-workspace provisioning.
8. Test ordinary team members can edit any task/inbox item while guests/personal accounts cannot; verify assignment is not interpreted as an ACL.
9. Test guest signup claim race, link/access expiry, no-expiry case, revocation, restricted group/message scope and denial of every disallowed HTTP/socket action.
10. Test group member/admin/owner update/add/remove/role/leave/post/pin behavior, including protected owner and owner succession.
11. Test a platform admin who is only a group member and a workspace owner who is not meeting host; deny resource-specific authority appropriately.
12. Test meeting invite versus link registration, lobby/password passes, host-only report/polls/moderation and historical-attendee notes rights.
13. Test embedded capability off, another App user's IDs/codes, normal exact cross-workspace discovery and endpoint-specific tenant gaps. Treat failures as explicit review items.
14. Check personal API-key required scopes and active owner; do not rely on protect session semantics where apiKeyAuth is used instead.
15. Check profile/signup body cannot set role, workspaceRole or owner arbitrarily; ensure logs/documents contain no secrets.
16. Check frontend navigation, account switch, role refresh and server error messages on desktop, mobile and embedded surfaces.

Existing suites include super-admin.mjs for boot reconciliation, admin-delete.mjs for deletion/access guards, group-membership.mjs, feature-coverage.mjs, platform.mjs, security-embed-origins.mjs and the meeting suites. The test directory has no dedicated rbac-named matrix suite in the inspected tree. Read suites before running; some reset derived fixture databases. Use isolated approved data. No database-mutating tests were run for this documentation request.

## 14. Troubleshooting and source ownership

| Symptom | Check / interpretation |
|---|---|
| Workspace admin cannot open admin dashboard | User.role must be platform admin |
| Platform admin cannot edit group | Actual participant role; groupCan has no platform override |
| Platform admin denied guests/activity | Direct workspaceRole manager check plus team type |
| Owner cannot promote someone to owner | Use transfer endpoint, not member-role PATCH |
| Suspended user still sees live events | Existing socket is not necessarily disconnected by tokenVersion |
| Role changed but button unchanged | Reload user/workspace/chat state and relevant caches |
| Team member can edit another task | Current team-wide task policy, not assignee-only ACL |
| Guest gets 403 despite group membership | Route allowlist, expiry and allowed-chat fields |
| API-key call differs from user-session call | Different authentication middleware and scope checks |
| Workspace lookup returns 404 for target | Target outside req.user.workspace or missing record |

| Source | Responsibility |
|---|---|
| server/utils/rbac.js | Constants, static matrices and helpers |
| server/middleware/auth.js | User/session gate, guest allowlist, adminOnly |
| server/socket/index.js | Socket auth, resource membership and meeting host flags |
| server/models/User.js and server/models/Chat.js | Stored role dimensions |
| server/controllers/workspaceController.js | Member and ownership mutation rules |
| server/controllers/workspaceToolsController.js | Direct manager/team/assignee/source checks |
| server/controllers/groupController.js | Participant permissions and owner protections |
| server/controllers/messageController.js and server/utils/pins.js | Posting/pin policy |
| server/controllers/meetingController.js | Meeting host and attendee permissions |
| server/controllers/adminController.js | Platform account moderation |
| server/utils/superAdmin.js | Single-admin environment reconciliation |
| server/utils/tenancy.js and server/utils/appAuth.js | App isolation/capabilities/secret authentication |
| server/middleware/apiKey.js | Personal owner-scoped integration keys |
| server/controllers/agentController.js and catalogController.js | Workspace business permissions |
| client/src/pages/SettingsPage.jsx and WorkspacePage.jsx | Workspace display permissions |
| client/src/App.jsx and GuestPortal.jsx | Restricted guest navigation |

Use the Workspace Developer Guide for complete workspace endpoint payloads and the Meeting Developer Guide for room flows. Any policy change should update server checks, UI affordances, documentation and authorization tests as one implementation change.

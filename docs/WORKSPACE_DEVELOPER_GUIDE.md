# ChatKonect Workspace Developer Guide

Updated: 15 October 2026 | Audience: application developers, backend engineers and QA

Implementation handoff based on the current working tree. This guide covers the workspace lifecycle, administration, shared team tools, limited guests, business features, REST contracts, realtime refresh, operation and acceptance testing. Example IDs, origins and credentials are placeholders. No live secrets are included. Behavior described here has been checked against source; it is not a deployment test report.

## 1. Workspace model and product boundaries

A user has one current `workspace` reference and one `workspaceRole`. The repository does not implement a many-workspace membership collection or a workspace switcher. Workspace roles are owner, admin, member and limited guest. The account's platform role and each group's participant role are separate; consult ChatKonect_Role_Based_Access_Guide.docx for the full authorization reference.

There are two workspace types. A team workspace represents a company/team and has a roster, management settings, shared inbox, tasks, guests and activity. Personal accounts join one shared workspace with slug personal-space; it has no browsable member roster or normal team management experience. Its nominal owner reference does not make every personal user a manager.

An embedded App tenant is a different entity from a workspace. App tenant isolation uses User.app; workspace administration uses User.workspace. Ordinary exact identity discovery can cross workspace boundaries inside the same app tenant. Do not describe a workspace as a universal contact/media isolation wall: different endpoints apply identity, membership and workspace rules separately.

### Feature inventory

- Company signup and owner provisioning; shared personal signup; workspace invite signup.
- Workspace summary, team roster, role/status labels and member count.
- Rename, invite-link visibility and rotation, promotion/demotion, pause/resume, removal and ownership transfer.
- Business profile, greeting/away auto-replies, catalog, labels and quick replies.
- Explicit customer-to-team inbox, customer view, replies, internal notes, assignment and open/pending/closed status.
- Team tasks: create, assign, due dates, complete/reopen, manual/message/meeting source and due notification.
- One-use guest signup invitation with selected groups, access expiry, restricted guest portal and revocation.
- Manager-only activity feed, persisted audit events and realtime inbox/task refresh.
- Boot migration for legacy users/chats without workspace references.

## 2. Onboarding and workspace lifecycle

POST `/api/auth/signup` is the signup entry point. Follow the existing authentication/email-verification flow in authController; workspace fields are additional inputs, not a replacement for required identity/password verification.

```json
{
  "name": "Example Owner",
  "email": "owner@example.com",
  "password": "EXAMPLE_ONLY_123",
  "accountType": "workspace",
  "workspaceName": "Example Team"
}
```

Explicit accountType workspace creates a type team workspace and sets the new user's workspaceRole to owner. Missing accountType defaults to personal in the current signup implementation. Personal signup attaches the user as member to the shared Personal space. Do not use older comments claiming that omitted accountType creates a company workspace.

To join a team during signup, supply inviteCode, or the supported invite alias. A valid invite takes precedence over personal selection and creates a member. The shared link is `CLIENT_URL/signup?invite=INVITE_CODE`. Workspace invite codes are random 12-character base64url values generated from nine bytes. They are reusable until rotated; no time expiry is stored on Workspace. Rotation invalidates the old code for future joins, not existing members.

Guest signup supplies guestToken instead. A normal invite and guest token cannot be supplied together. Guest tokens are 48-character hex values; their SHA-256 hashes, expiry and one-time claim are stored server-side. See section 9 for the full restricted flow.

createWorkspaceForUser creates the workspace, sets owner, clears guest fields and saves the user. Slug generation normalizes the name and resolves collisions. The schema default type is team. Consequently member removal creates a new individually owned team workspace, even though some comments/UI wording describe a personal space.

There is no public create-workspace, join-existing-account, switch-workspace or delete-workspace endpoint in workspaceRoutes. The service helpers are internal and are not implied public APIs.

## 3. REST authentication and workspace summary

Workspace routes are mounted under `/api/workspaces` and use protect. Send a valid end-user Bearer access token or the supported first-party session cookie. The server checks current account state, tokenVersion and the tracked session. Do not use an app secret or personal API key as a replacement for this router's user session.

GET `/api/workspaces/me` returns success, workspace, myRole, members and, for a team, memberCount. Workspace exposes _id, name, slug, type, plan, owner, businessProfile and createdAt. For non-personal workspaces, managers also receive inviteCode, inviteLink and autoReplies. Non-manager roster fields are name, username, avatar, online/last-seen values, workspaceRole, accountStatus and createdAt; this is not an email directory endpoint.

Personal summary returns members as an empty array, omits memberCount and withholds invitation/internal auto-reply data. A user with no resolvable workspace receives 404. The frontend store swallows summary-load failures, so the screen can remain in Loading workspace when offline or missing data; a custom client should show a retry/error state.

### Administration endpoints

| Method | Path after /api/workspaces | Access / purpose |
|---|---|---|
| GET | /me | Current workspace and team roster |
| PATCH | /me | Manager updates name/profile/auto-replies |
| POST | /me/invite/rotate | Manager replaces signup invite code |
| PATCH | /me/members/:userId/role | Manager sets admin/member |
| PATCH | /me/members/:userId/status | Manager pauses/resumes another member |
| DELETE | /me/members/:userId | Manager removes another non-owner |
| POST | /me/transfer | Transfer-permission holder changes owner |

These routes act on req.user.workspace; a submitted workspaceId cannot switch their target organization. The central permission helper grants a platform admin an override, but the resource query remains scoped to that admin's current workspace. This router is not an all-workspace admin console.

## 4. Workspace settings, invites and business profile

PATCH me accepts a nonblank name, trimmed and capped at 80 characters. It also accepts businessProfile and autoReplies; arbitrary workspace plan, owner, type, slug and verified changes are not copied from the body.

```json
{
  "name": "Example Operations",
  "businessProfile": {
    "category": "Support",
    "description": "Customer assistance",
    "hours": "Mon-Fri 09:00-18:00",
    "address": "Example office",
    "website": "https://example.com",
    "email": "support@example.com"
  },
  "autoReplies": {
    "greeting": { "enabled": true, "text": "Welcome to our team." },
    "away": {
      "enabled": true, "text": "We will reply during office hours.",
      "startHour": 9, "endHour": 18
    }
  }
}
```

Only category, description, hours, address, website and email are accepted as profile text, each capped to 1,000 characters by the controller. verified cannot be self-set. The stored free/pro/business plan is metadata here; no plan upgrade/billing or per-plan workspace feature quota is enforced by this route.

Greeting and away text are capped at 1,000 characters. Hours are integer-clamped to 0-23. Send actual booleans rather than strings, because Boolean conversion treats the string false as true. Settings save records workspace.update and invalidates negative auto-reply caches when auto-reply configuration changes.

Auto-replies apply to inbound classic one-to-one chats with a business-side participant and a sender outside that business's workspace. They do not copy private DMs into the shared inbox and are not implemented as inbox automatic replies. Away replies take priority outside the configured interval and are throttled to one per chat per hour. Overnight windows are supported; equal start/end means always open. Greeting sends once before a prior auto-reply exists. Hour calculation uses the backend host's local timezone, not the user's browser or a workspace timezone field. Processing is queued/best effort; no-auto-reply results are cached for up to five minutes and invalidated on configuration change.

POST rotate requires no body and returns a manager workspace representation with the new invite. Save may retry on duplicate-code collisions. Audit action is workspace.invite.rotate. Show/share only with authorized teammates; possession of this code permits future signup into the organization.

## 5. Member roles, account access and removal

Role body is `{ "role": "admin" }` or member. The target must be in the caller's current workspace. An owner cannot be changed through this endpoint, and a guest cannot be converted this way. Manager is owner/admin by central workspace permission, with the platform helper override. An admin can manage another admin; there is no owner-only admin promotion rule. Backend self-role change is not explicitly blocked, while the Settings UI hides self-management controls.

Status body is `{ "status": "suspended" }` or active. The caller cannot change their own access, pause the owner or lift a platform banned status. Suspension updates the account-wide accountStatus and increments tokenVersion. In the one-workspace model, it affects all access for that account, not merely the workspace tab. Resuming does not restore old token versions; the user needs a fresh valid session. It does not explicitly disconnect every already-open socket at the mutation point.

DELETE member preserves the account but removes it from all chats tagged with the old workspace, including direct chats and groups. It removes mutual contacts/favorites/blocked references from other accounts in that workspace, clears the departing user's contacts/favorites, provisions a fresh owned team workspace, then increments tokenVersion. It is not account deletion. Neither owner nor self may be removed. Chats whose workspace is null, including mixed-workspace groups, are outside this sweep.

POST transfer body is `{ "userId": "ACTIVE_MEMBER_ID" }`. Normally only the owner has workspace:transfer; the central platform override can also pass it. The target must be a different active non-guest in the same workspace. The implementation promotes the target to owner, demotes the requester to admin, updates Workspace.owner and records workspace.transfer. These writes are sequential, without a transaction. Avoid concurrent transfers and reload workspace plus user state after success.

## 6. Shared team inbox

The inbox is an explicit team/customer conversation. Existing private DMs are never automatically copied into it. A signed-in external customer opens `/team/:workspaceId`; the initial message POST creates or reuses a thread unique to workspace plus customer. A team member cannot create their own customer thread against the same workspace.

| Method | Path after /api/workspaces | Contract |
|---|---|---|
| POST | /:workspaceId/inbox | Customer starts/appends with text; 201 |
| GET | /customer/inbox | Customer's latest 100 thread summaries |
| GET | /me/inbox | Team latest 100, optional status filter |
| GET | /me/inbox/:id | Team member or owning customer detail |
| POST | /me/inbox/:id/replies | Customer/team reply with text |
| PATCH | /me/inbox/:id | Team status and/or assignedTo |
| POST | /me/inbox/:id/notes | Team-only internal text note; 201 |

The me segment in detail/reply routes is historical naming: an owning customer can use those two handlers even though the thread belongs to another workspace. The controller authorizes using workspace membership OR owning-customer identity; guests remain blocked by protect before reaching the handlers.

```json
{ "text": "Please help with my account." }
```

Text is trimmed/capped at 5,000 characters, blank is rejected, and a thread holds at most 1,000 messages. Internal notes use the same text limit with a cap of 200 notes. Reaching a cap gives 409. Customer messages reopen the thread; team replies do not necessarily reopen a closed thread. Status enum is open, pending, closed. There is no delete/archive/new-thread-after-full API; the unique workspace/customer pair keeps reusing the same thread.

PATCH accepts `{ "status": "pending", "assignedTo": "ACTIVE_TEAM_USER_ID" }`. Empty/falsy assignedTo clears assignment. Assignees must be active non-guests in the same workspace. All active non-guest team members can read, reply, assign, change status and add notes; assignment is organization of work, not an access restriction.

Customer detail explicitly removes notes. Team list returns complete lean thread records including messages and notes, so internal-note confidentiality must also be reviewed on every other response path; see section 13 for the raw start-thread response issue.

## 7. Tasks and reminders

| Method | Path after /api/workspaces | Purpose |
|---|---|---|
| GET | /me/tasks | Latest query-limited 300 team tasks |
| POST | /me/tasks | Create task; 201 |
| PATCH | /me/tasks/:id | Edit fields or complete/reopen |

All non-guest members of a team workspace may create and edit any team task. There is no creator-only or assignee-only mutation check. Tasks are scoped by current workspace; assignees must be active non-guests in it. List populates assignee/creator name and avatar and sorts by status, dueAt and descending createdAt; status sorting is lexical, not a promised open-first ordering.

```json
{
  "title": "Follow up on the review",
  "description": "Send the agreed implementation details.",
  "assignee": "ACTIVE_TEAM_USER_ID",
  "dueAt": "2026-10-25T09:30:00.000Z",
  "source": { "kind": "manual", "id": null }
}
```

Title is required, trimmed and capped at 180 characters. Description is capped at 3,000. dueAt may be null; a supplied date must be valid and in the future at create/update time. Status is open or done; creation defaults to open. PATCH supports status, title, description, assignee and dueAt, but not changing source. Updating dueAt resets reminderSentAt.

Source kind message requires a valid Message whose chat has the caller as participant and is tagged to the current workspace. Source kind meeting requires a valid meeting where the caller is host/participant and the host's current workspace matches the team. Meeting notes can create such tasks after saving; message-derived task actions use the same endpoint. Unrecognized source kinds fall back to manual rather than being a documented strict enum error at the controller boundary.

The due dispatcher runs at startup and every 60 seconds. It claims up to 100 open, assigned, due/overdue tasks with no reminderSentAt. It emits workspace-task-updated to the assignee and calls notifyUser with Team task due and `/workspace?tab=tasks`. This is a due-time notification, not advance scheduling, repeated escalation or guaranteed email. An atomic stamp prevents duplicate claims; no per-recipient delivery retry is implemented here. Completing/reopening or reassigning alone does not reset an already-sent reminder.

## 8. Activity and realtime refresh

GET `/api/workspaces/me/activity` is restricted to owner/admin workspaceRole by workspaceToolsController after the team gate. It returns `{ success: true, events }`, latest 200 sorted newest first, with actor name/avatar. An event stores workspace, actor, action, target, detail and timestamps; action max 80, target max 180 and detail max 500 characters. There is no activity export, pagination or retention/TTL policy in this schema.

Actions include workspace.update, workspace.invite.rotate, workspace.transfer, member.role, member.status, member.remove, inbox.reply, inbox.update, inbox.note, task.create, task.update, guest.invite, guest.join, guest.revoke, label.create/delete/apply/remove and quick_reply.create/update/delete. This is a selected application activity feed, not an audit of every database write. Customer messages and background expiry are not logged through every same action path. Product catalog mutations do not call this audit helper in the inspected controller.

| Event | Payload | Recipients / handling |
|---|---|---|
| workspace-inbox-updated | threadId | Active non-guest team members plus customer; re-fetch list/detail |
| workspace-task-updated | taskId | Active non-guest team members; re-fetch tasks |

Events are user-room notifications emitted by the backend, not client commands or complete records. Register them on the authenticated socket, remove listeners on unmount and do a fresh fetch after reconnect. The current team inbox refreshes its list every 30 seconds as well as using events; the task screen uses initial load plus events without a periodic polling timer. The customer contact screen polls every 15 seconds; guest messages poll every eight seconds because guest sockets are denied. Settings member changes have no dedicated workspace-role-changed event; explicitly refresh user/workspace state.

## 9. Limited guest invitation, portal and expiry

| Method | Path after /api/workspaces | Purpose |
|---|---|---|
| GET | /me/guests | Manager lists guest accounts and invitation summaries |
| POST | /me/guests/invites | Manager creates limited signup link; 201 |
| POST | /me/guests/:id/revoke | Manager revokes an existing guest account |

```json
{ "chatIds": ["TEAM_GROUP_ID"], "days": 7 }
```

Select 1-20 unique valid team group IDs. Each must be a group tagged with the caller's workspace. days defaults to seven; allowed values are integers 1-90, or null/empty string for no access expiry. The URL is `CLIENT_URL/signup?guest=RAW_TOKEN`. Return data includes invitation _id, chats, expiresAt, accessDays and url. The raw token is returned once; the hash is stored. Invite-link expiry is always seven days, independent of the guest's access duration after claiming.

Signup atomically claims an unexpired unused invitation, creates a workspaceRole guest account, sets guestAllowedChats and guestExpiresAt, and adds it as a member to the selected group participants. Access days start at signup. A claim race returns 409 and deletes the just-created losing user. Group provisioning and claim are not one database transaction; review failure recovery for interrupted signup.

The main app redirects a guest to `/guest`. The portal lists only assigned groups, loads their messages over HTTP and permits text-only replies. Protect allows only GET auth/me, GET chats or chats/:id, GET messages/:chatId, POST messages and POST auth/logout for guests. The message controller also requires an allowed group and disallows attachment bodies, mentions, forwardedFrom, location and replyTo. Guest upload, group admin, meetings, calls, contacts, workspace tools and sockets are unavailable. The portal does not download attachments or subscribe to realtime events.

Revocation pulls the guest from allowed groups in that workspace, sets suspended, stamps expiry to now and increments tokenVersion; returns success. It does not delete the account or revoke an unclaimed invitation link. There is no unclaimed-invite deletion endpoint in these routes.

Expiry runs at startup and each minute, processing up to 100 active expired guests. An atomic status claim suspends and increments tokenVersion, then removes group membership. protect and login/refresh also check expiry, so access need not wait for the next sweep. null expiry means until revoked. Temporary invitation expiry and account access expiry are separate states.

## 10. Catalog, labels and quick replies

These features extend the workspace business experience but live under separate authenticated routers. Manager checks use workspace:settings; ordinary members may use the shared resources in accessible chats. Guests are excluded by their route allowlist.

| Endpoint | Main contract |
|---|---|
| GET /api/catalog/mine | Current catalog and canManage |
| GET /api/catalog/:workspaceId | Signed-in business catalog browse |
| POST /api/catalog | Manager create product |
| PATCH /api/catalog/:id | Manager update within current workspace |
| DELETE /api/catalog/:id | Manager delete within current workspace |
| POST /api/catalog/:id/share | Share product snapshot to a participant chat |
| GET /api/agent/labels | Current labels and canManage |
| POST /api/agent/labels | Manager creates name/color |
| DELETE /api/agent/labels/:id | Manager deletes workspace label |
| GET /api/agent/labels/chat/:chatId | Participant's visible workspace labels |
| POST /api/agent/labels/:id/apply | Participant applies/removes with chatId, apply |
| GET /api/agent/quick-replies | Shared definitions and canManage |
| POST /api/agent/quick-replies | Manager creates shortcut/text |
| PATCH /api/agent/quick-replies/:id | Manager edits definition |
| DELETE /api/agent/quick-replies/:id | Manager deletes definition |

Product fields include name (120), description (2,000), nonnegative price, currency (eight characters, USD default), at most 10 allowed image URLs, link (500) and inStock. Images accept /uploads/ or HTTPS. Product sharing requires chat participation and embeds a snapshot so later catalog changes do not rewrite old messages. Catalog reads cache for 120 seconds and mutations invalidate the workspace cache. Treat further commerce functions such as checkout, orders and payments as outside this implementation.

Labels have name capped at 40 and color at 20 characters; duplicate workspace/name creates 409. Apply defaults true; send actual false to remove. Quick-reply shortcut removes leading slashes and is capped at 40; text is capped at 2,000. Duplicate workspace/shortcut gives 409. Definition create/update/delete are manager-only; using the resulting text is ordinary chat sending, not a separate privileged send API.

## 11. Data model, storage and operational setup

Workspace stores name, slug, type, owner, inviteCode, plan, businessProfile, autoReplies, generic settings and timestamps. User stores its current workspace, workspaceRole, accountStatus, tokenVersion, guestExpiresAt and guestAllowedChats. Chat.workspace is an organizational tag; actual reading/sending normally requires chat participation. A cross-workspace group can have workspace null, and adding an outside user clears an existing workspace tag.

WorkspaceInboxThread has a unique workspace/customer pair, status, assignee, message and note subdocuments. WorkspaceTask has workspace, creator, assignee, title, description, dueAt, reminderSentAt, status and source. WorkspaceGuestInvite has hashed token, selected chats, expiry, accessDays, claimant and creator. WorkspaceAudit stores action records. Compound indexes support list ordering and task queries; they are not an API pagination contract.

MongoDB and valid user/session signing configuration are required. CLIENT_URL must be the correct frontend origin for team and guest links. Redis is optional for caches and multi-instance socket coordination; ensure appropriate Socket.IO adapter setup when running multiple servers. The task reminder and guest expiry workers are timers started by server boot; a stopped API process cannot dispatch them. Auto-reply hours depend on the execution host timezone; configure operations expectations accordingly. No new environment secret is required just to read these documents.

ensureWorkspaces is a boot migration for users/chats missing workspace. It can create Default Workspace with business plan metadata, choose a platform admin or existing user as owner, assign orphans and promote the chosen owner. getWorkspaceType caches results for an hour with local memo and optional Redis. Review migrations separately from ordinary signup; helper comments about universal isolation or default account type are not always aligned with current endpoint behavior.

## 12. Frontend and integration handoff

Use `/workspace?tab=inbox|tasks|guests|activity` for the dedicated team tools page. Managers see all four tabs; ordinary team members see inbox and tasks. The Settings workspace section handles name, invite, roster, role, status, removal and ownership controls. BusinessPage and chat UI host business/catalog/agent tools. The team customer route is `/team/:workspaceId`; it requires authentication. Guest signup redirects to the limited portal after normal account creation/login.

useWorkspace is the client store for summary and mutations. Refresh after transfer, role change or account switch; its transfer mutation updates myRole/members optimistically after HTTP success but does not synchronize every user/owner pointer in all stores. Preserve server error messages when reporting mutation failures. UI visibility does not replace server checks, and backend allowance can be broader than a hidden UI control.

Hosted embed does not expose a workspace tools route, team admin console or business management console through EmbedApp's current route set. App capabilities do not automatically turn on a workspace switcher. A custom host/native integration should use supported user-session APIs and implement appropriate identity/permissions; personal API-key v1 routes do not provide this full administration API. Consult DEVELOPER_INTEGRATION.md for the distinct App identity bridge.

## 13. Current limitations and review items

- One current workspace per user; no switcher, multi-membership, workspace deletion or public leave-team API is implemented in workspaceRoutes.
- Most workspace tools scope by workspace but do not also apply tenantScope to external team IDs. Customer inbox creation and public catalog browsing need a cross-app isolation review before being used as hard embedded tenant boundaries.
- The startInboxThread response returns the raw existing thread. If a customer appends using that endpoint after internal notes exist, those notes can be included despite detail-handler redaction. Do not promise complete internal-note confidentiality without fixing/testing that response path.
- Core admin helpers include the platform-admin override, while workspaceTools manager checks use only owner/admin workspaceRole. UI also uses workspaceRole. A platform admin can therefore pass some settings gates but fail guest/activity gates or see no manager controls.
- Member removal provisions a new team workspace, not the shared Personal workspace. Mixed-workspace chats are not removed by its old-workspace sweep; tasks, guest fields, meetings and other references are not a comprehensive account purge.
- Ownership transfer and member removal are sequential multi-record operations with no transaction. Audit persistence is awaited after mutations, so an audit write failure may return an error after the main mutation already succeeded. Re-fetch before blindly retrying.
- Suspension/removal increments tokenVersion for future protected requests/reconnects but does not proactively disconnect every established socket or evict it from all existing rooms.
- Guest revocation does not cancel unused invitation links. Guest expiry can mark an account suspended before a later group-removal failure; a retry sweep only selects active guests, so failed cleanup needs operational reconciliation.
- Thread/list/task/activity limits are caps without pagination. There is no task delete, inbox delete/archive, attachment-capable team-inbox message or immutable audit export here.
- Task reminder claims precede delivery. Reassign/reopen does not reset reminderSentAt; no repeated escalation or delivery retry is implemented.
- Some Settings copy describes a stricter workspace contact wall than the current exact identity discovery and meeting invite code enforces. Follow actual endpoint checks, not that copy or older service comments.
- Profile verified and plan fields exist, but this guide does not imply self-service verification, billing or custom permission administration.

## 14. QA, errors and troubleshooting

HTTP 400 normally means invalid input or protected target, 401 invalid/revoked session, 403 missing role/team/guest permission, 404 missing or out-of-scope resource, and 409 duplicate/used/full resource. Validation middleware can produce further field errors; preserve the returned message. A 500 after a mutation requires a state re-fetch because audit/notification work may have failed after persistence.

1. Sign up with missing accountType, explicit workspace, normal invite and guest token. Verify default personal behavior, owner/member/guest fields and no client-chosen platform admin.
2. Compare personal/team summary and manager/member invite visibility. Verify another team's ID cannot replace the me scope.
3. Rename, rotate invite and try the old/new code. Verify existing members remain members.
4. Promote/demote another member and peer admin, protect owner/guest, test direct self-role requests versus hidden UI controls.
5. Pause/resume, deny self/owner/platform-banned targets, and test old HTTP tokens, reconnects and already-open sockets.
6. Remove a member; verify tagged group/direct participation, contacts, new team ownership, tokenVersion and mixed-workspace chat behavior.
7. Transfer to active member/admin; reject self, outsider, guest and suspended target. Verify Workspace.owner plus both user roles and multi-write failure recovery.
8. Start customer thread, reply, assign, close/reopen and add internal notes. Test both detail and raw start responses for customer note leakage.
9. Check inbox 1,000-message and 200-note caps, invalid status, assignee workspace/status and concurrent duplicate-thread creation.
10. Create/edit/complete/reopen tasks; verify source membership, field limits, future dates, due notification claim and reassign/reminder behavior.
11. Create 1-20-group guest links; test one-time claim, seven-day link expiry, accessDays 1-90/null, expired/revoked login and restricted text-only portal.
12. Attempt guest meetings, calls, uploads, sockets, member management and unassigned messages. Verify cleanup after expiry/revoke and unsupported unused-invite cancellation.
13. Check manager-only activity, saved action metadata, 200-item limit, reconnect refresh and polling fallback.
14. Exercise profile whitelist, verified protection, greeting/away precedence, timezone/cooldown, labels, quick replies and catalog cache invalidation.
15. Test app-tenant boundaries, non-team tools rejection, mobile UI, logout/account switch and embed route absence.

Existing feature-coverage.mjs exercises workspace summary, personal rename denial and team business tools; route-coverage and group-membership suites offer related coverage. There is no dedicated workspace-named suite in the inspected test directory. Read tests before running: some derive and drop fixed databases from MONGO_URI. Run only against an approved isolated fixture. This documentation task did not execute database-mutating test suites.

## 15. Source map

| Source | Ownership |
|---|---|
| server/routes/workspaceRoutes.js | All core/team-tools routes |
| server/controllers/workspaceController.js | Summary/settings/invites/member administration |
| server/controllers/workspaceToolsController.js | Inbox/tasks/guests/activity |
| server/utils/workspaceService.js | Provisioning, invite join, personal space, legacy migration |
| server/utils/rbac.js and server/middleware/auth.js | Permissions and guest/session gate |
| server/controllers/authController.js | Signup type selection and guest claim |
| server/models/Workspace*.js | Workspace, task, inbox, guest invite and audit schemas |
| server/utils/workspaceAudit.js | Audit persistence |
| server/utils/workspaceGuestExpiry.js | Expiry sweep |
| server/utils/workspaceTaskReminders.js | Due-time dispatcher |
| server/utils/autoReply.js | Direct-chat business automation |
| server/controllers/catalogController.js | Catalog and product sharing |
| server/controllers/agentController.js | Labels and quick replies |
| client/src/pages/WorkspacePage.jsx | Team tools screens |
| client/src/pages/SettingsPage.jsx | Core workspace management UI |
| client/src/pages/TeamContactPage.jsx | Customer/team conversation |
| client/src/pages/GuestPortal.jsx | Restricted guest experience |
| client/src/store/useWorkspace.js | Client state and HTTP actions |

Keep this guide and the separate role-based guide aligned whenever permissions, target protections, guest allowlists, workspace types or resource scoping change.

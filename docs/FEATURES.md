# ChatConnect — Complete Feature Catalog

> WhatsApp-style messaging platform. **Frontend:** React 18 + Vite, Zustand, Socket.IO client, Framer Motion, Tailwind. **Backend:** Node/Express (ESM), MongoDB/Mongoose, Socket.IO, JWT, optional Redis/BullMQ/Cloudinary.
>
> Last updated: 2026-07-19

---

## Table of Contents

1. [Authentication & Account Security](#1-authentication--account-security)
2. [Chats & Messaging](#2-chats--messaging)
3. [Groups & Communities](#3-groups--communities)
4. [Status / Stories](#4-status--stories)
5. [Calls (WebRTC)](#5-calls-webrtc)
6. [Meetings (Google-Meet style)](#6-meetings-google-meet-style)
7. [Contacts & Reachability](#7-contacts--reachability)
8. [Business Features](#8-business--whatsapp-business-features)
9. [Workspaces / Multi-tenancy](#9-workspaces--multi-tenancy)
10. [Notifications](#10-notifications)
11. [Admin & Moderation](#11-admin--moderation)
12. [Developer / Public API](#12-developer--public-api)
13. [Media & Uploads](#13-media--uploads)
14. [Security & Infrastructure](#14-security--infrastructure-cross-cutting)
15. [Client App Shell & Routing](#15-client-app-shell--routing)
16. [Realtime Socket Events Reference](#16-realtime-socket-events-reference)

---

## 1. Authentication & Account Security

| Feature | How it works |
|---|---|
| **Email-verified signup** | `POST /api/auth/email/send-code` emails a 6-digit OTP (10-min expiry, max 5 attempts, stored in `EmailVerification`); verifying it returns a short-lived signed `emailToken` that `POST /api/auth/signup` requires — so no unverified account ever exists. Username is derived from email; phone is required and normalized. |
| **Phone / email / username login** | `POST /api/auth/login` resolves the identifier across email, username, and phone (matches with/without `+`, last-10-digit fallback), then disambiguates by bcrypt password. Rejects unverified/suspended accounts. |
| **Access + refresh tokens with Session registry** | Every login creates a `Session` doc (SHA-256-hashed rotating refresh token, device parsed from user-agent, IP, `lastActiveAt`). The 1h access JWT carries a session id (`sid`) which the `protect` middleware re-validates on **every request** (revoked? expired? idle too long per `SESSION_IDLE_DAYS`?). `POST /api/auth/refresh` rotates the refresh token and mints a new access token; the client does single-flight refresh on 401 with request replay. |
| **Device / session management** | Settings → Account: `GET /auth/sessions` lists devices; revoke one (`DELETE /auth/sessions/:id`) or log out all others (`POST /auth/sessions/revoke-others`). |
| **Password reset & change** | Forgot-password emails a hashed 30-min reset token (always returns success to prevent email enumeration). Reset and change-password both bump `tokenVersion` and revoke all sessions, then re-issue for the current device. |
| **Two-step verification (app-lock PIN)** | Bcrypt-hashed 4–8 digit PIN under `/api/auth/two-step/*` (enable / change / disable / verify / forgot / reset via email OTP, rate-limited with attempt lockout). Client shows a `LockScreen` once per browser session; the same PIN also gates **locked chats**. |
| **Account deletion (GDPR)** | `DELETE /api/users/me` erases 1:1 chats + messages, removes the user from groups (reassigning owners), deletes statuses/requests/notifications/calls/meetings/reports, and scrubs references from other users. |
| **Data export** | `GET /api/users/me/export` downloads a JSON archive of your own profile, contacts, chats, and messages. |

---

## 2. Chats & Messaging

### Conversations
- **Unified `Chat` model** for 1:1 and groups: `participants[{user, role}]`, workspace tag, group metadata, `lastMessage`, `pinnedMessages`, `disappearingSeconds`, `labels`.
- **Direct chats require mutual contacts** and are get-or-create: `POST /api/chats/direct/:userId`.
- **Chat list** (`GET /api/chats`): pin / archive / mute flags per user, unread counts computed in a single MongoDB aggregation (no N+1), filters (All / Unread / Groups / Archived / Locked), name search, pinned section.
- **Chat lock:** hide chats behind the two-step PIN (`POST /chats/:id/lock`); a "Locked" folder reveals them after `POST /chats/locked` verifies the PIN. Forgot-PIN recovery supported.
- **Clear messages** (per-user via `deletedFor`) and **delete chat / exit group**.
- **Disappearing messages:** per-chat presets Off / 24h / 7d / 90d (`PATCH /chats/:id/disappearing`); the server stamps `expiresAt` on each message and a **MongoDB TTL index** deletes them automatically (no cron).

### Message types
| Type | How it works |
|---|---|
| **Text** | Rich formatting, emoji picker, auto-growing composer, Enter-to-send, per-chat drafts persisted in localStorage. |
| **Images / video** | Multi-select upload or live **camera capture** (`getUserMedia` overlay → JPEG, with a captured-photo preview and Retake / Send confirm step); 2-column grid for multiple images. |
| **Voice notes** | Hold-to-record via `MediaRecorder` with live timer; rendered as a playable waveform bubble with elapsed time. |
| **Documents** | pdf/doc/xls/ppt/txt/zip as a download card with file size. |
| **Location** | One-shot map link. |
| **Live location** | Streams `watchPosition` updates for up to 1h (server max 8h) over `POST /api/live-location/*`; peers get lightweight `live-location` socket events; pulsing "live" badge and stop control. |
| **Polls** | Question + 2–12 options, single or multiple choice; live vote bars, tap to vote/unvote, synced via `message-updated`. |
| **Product cards** | Catalog items shared into chat with image/price/link (see §8). |
| **View-once media** | Tap-to-open once per recipient; the media file is purged from storage once all recipients have viewed it. |
| **System messages** | Auto-posted for group events (member added/removed/left/joined, group created). |

### Message actions
- **Reply** (quoted preview), **forward** (multi-chat picker), **reactions** (quick-emoji bar, one per person, WhatsApp-style toggle), **star** (per-user starred list at `GET /messages/starred`), **pin**, **copy**.
- **Edit** own text messages within **5 minutes of sending** (shows "edited"; enforced server-side, option hidden in the UI after the window); **delete for me** or **delete for everyone** (tombstone).
- **@mentions** with autocomplete in group chats.
- **In-chat search** (live filter) plus server-side search (`GET /messages/:chatId/search?q=`).

### Delivery & receipts
- **Ticks:** single ✓ sent → grey ✓✓ delivered (socket `message:delivered` persists `deliveredTo`) → blue ✓✓ read (`message:read` persists `readBy`, honoring the reader's read-receipt privacy). `!` marks failed sends (optimistic send with reconciliation).
- **Typing indicators:** debounced `typing-start` / `typing-stop` relayed to the chat room.
- **Fan-out:** each send emits `receive-message` to every participant's personal room, `chat-updated` to others, and queues in-app + push notifications off the request path.

---

## 3. Groups & Communities

### Groups
- Create with name/description/members (workspace-scoped); creator becomes **owner**.
- **Roles & RBAC:** owner/admin/member enforced by the central permission matrix (`server/utils/rbac.js`). Admins can rename, edit avatar, add/remove members (adding honors each invitee's "who can add me to groups" privacy), and promote/demote.
- **Invite links:** CSPRNG invite codes; join via code. Owner can't be removed; if the owner leaves, the earliest member is promoted; empty groups are deleted.
- **System messages** for lifecycle events; live sync via `group-updated` socket events.
- **Group messaging policy:** groups can restrict posting to admins (used by community announcements).

### Communities
- **Groups-of-groups** (`Community` model) with an auto-created **announcement channel** (a group chat with `messagingPolicy: 'admins'` — admins post, everyone reads).
- Join/leave via invite code (joins/leaves the announcement group automatically); admins link topic groups; members see the linked group list.

---

## 4. Status / Stories

- Post **text statuses with gradient backgrounds**, images, or video; auto-expire after **24h** via TTL index.
- **Per-status privacy audience:** everyone / contacts / selected / except — enforced both in the feed and when serving status media files.
- **Feed** groups statuses by user: My status, Recent, Viewed (seen state tracked).
- **Full-screen viewer:** auto-advancing progress bars, tap zones, hold-to-pause, keyboard navigation, next/previous person.
- **Viewer list** on your own statuses (owner-only); **reply bar** on others' statuses — replies deliver to the owner with a `status-reply` socket event.

---

## 5. Calls (WebRTC)

- **1:1 audio/video calls:** real WebRTC media, signaling relayed over Socket.IO (`call:offer` / `call:answer` / `call:ice-candidate` / accept / reject / cancel / end / busy / screen). STUN + optional TURN (env-configured or runtime-fetched credentials).
- **Authorization:** signaling is gated by `canSignal` — mutual contacts or shared group membership. `POST /api/calls/start` asserts mutual contacts and creates the `Call` record **before** ringing.
- **Server-side state machine** (`utils/callService.js` `transitionCall`): every signaling event updates the `Call` record (ringing → accepted → ongoing → completed / missed / rejected; terminal states never regress), so history stays correct even if a client dies mid-call.
- **Group calls:** mesh of peer connections keyed by user id; **"Add people"** rings extra contacts into a live call.
- **In-call controls:** mute, camera toggle, speaker/output device switch (`setSinkId`), **noise-cancellation** toggle, **screen share** with presenter spotlight + filmstrip, grid vs auto layout, fullscreen, and **minimize to a floating pill** that keeps media alive; open chat during a call.
- **Busy handling:** already on a call or in a meeting → auto-replies busy and shows a banner. Offline callee → logged as **missed** + push notification. **ICE-restart reconnection** with a "Reconnecting…" banner.
- **Call history:** `GET /api/calls/history` (last 100, enriched with direction + peer) with All / Missed / Incoming / Outgoing filters and quick re-call buttons.

---

## 6. Meetings (Google-Meet style)

- **Shareable `/meet/:code` links** with unguessable room codes — **any signed-in user** can join by code or pasted link (`GET /meetings/code/:code` preview → `POST /meetings/code/:code/join`), unlike contact-gated calls.
- **Scheduling** (`POST /api/meetings`): title, date/time, full IANA timezone list, audio/video type, recurrence (none/daily/weekly/monthly), host settings (**join anytime**, **mute on entry**, **auto-record**), invite contacts or **raw email addresses** (registered or not). In-workspace invitees get socket `meeting-invited` + push; email invites are fire-and-forget.
- **Instant meetings:** one click creates a meeting and drops you into the room.
- **RSVP:** Going / Maybe / Can't go for invitees.
- **Meeting room** (`pages/MeetingRoom.jsx`): full-mesh WebRTC over `mtg:<id>` socket rooms keyed by socketId (separate from `call:*` signaling). Waiting lobby when "join anytime" is off and the host is absent; video grid, screen-share spotlight (`meeting:presenting`), mute/camera/present controls; **local recording** composites all tiles + mixed audio into a downloadable `.webm` (host auto-record supported); copy meeting ID/link. Joining sets `inMeeting` so incoming calls answer busy.
- **In-meeting collaboration:** live **chat panel** (`meeting:chat`, in-call only), floating **emoji reactions** (`meeting:reaction`), **raise/lower hand** with a tile badge (`meeting:hand`), and **host moderation** — "Mute all" plus per-participant ask-to-mute and remove (`meeting:mute-all` / `meeting:force-mute` / `meeting:remove`, authorized against the stored host flag).
- **Calendar invites:** meeting invite emails carry a standards `.ics` attachment (`utils/ics.js`, VEVENT with UTC times + RRULE for recurring), so Gmail/Outlook/Apple Calendar show one-tap "Add to calendar".
- **Pluggable media transport (SFU):** `GET /meetings/code/:code/rtc` reports whether the room runs on the **LiveKit SFU** (when `LIVEKIT_URL/API_KEY/API_SECRET` are set) or the peer-to-peer mesh. `MeetingRoom.jsx` mounts `useLiveKitRoom` (LiveKit) or `useMeetingRoom` (mesh) behind an identical `RoomView`. The SFU lets each participant send one upstream to the server → rooms scale far past the mesh's ~6-peer ceiling; chat/reactions/hand-raise/host-moderation/attendance still ride the `mtg:<id>` socket room (keyed by user on the SFU path). Unset → mesh, exactly as before.
- **Attendance tracking:** `meeting:join` / `meeting:leave` / disconnect stamp per-attendee join/leave times and durations on the `Meeting` doc; the meeting flips to `ongoing` on first join and `completed` when the room empties. **Host attendance report** shows start time, duration, per-attendee presence bars, and live "in meeting" badges.
- **Meetings page:** upcoming list, 7-day calendar strip with day filter, grouped by day.

---

## 7. Contacts & Reachability

- **Global people search** (`GET /users/search?q=`): **exact match** by email / @username / phone works across *all* workspaces (intentional global reachability); **partial** name/username/email search is scoped to your own team workspace. Results respect presence privacy and hide phone/email from non-contacts.
- **Consent-based contact requests:** adding someone sends a `ContactRequest` (with optional message) — never a unilateral add. Mutual pending requests auto-accept. Accept adds both users to each other's contacts and fires `contact-accepted` + push; blocking is respected in both directions.
- **Favorites** (starred contacts strip), A–Z grouped list with per-row message / audio call / video call actions.
- **Blocking** — enforced server-side both ways; **reporting** — creates a moderation `Report` for the admin queue.
- **Privacy settings** (`PATCH /users/me/privacy`): last-seen and online-status audience (everyone / contacts / nobody) enforced by `utils/privacy.js`; read-receipts toggle; profile-photo visibility; "who can add me to groups".
- Contacts are **required** for DMs, 1:1 calls, and broadcast-list membership.

---

## 8. Business / WhatsApp-Business Features

Available to **team workspaces** (viewable by all members, editable by owner/admin via the `WORKSPACE_SETTINGS` permission):

| Feature | How it works |
|---|---|
| **Business profile** | Storefront on the `Workspace` doc: category, hours, website, contact email, address, about, verified badge (never self-settable). Edited via `PATCH /workspaces/me`. |
| **Product catalog** | `Product` CRUD under `/api/catalog`; public browse per workspace is **Redis-cached** (120s, invalidated on writes). `POST /catalog/:id/share` snapshots a product into a chat as a `product` message card. |
| **Auto-replies** | Greeting message (once per chat) and away message (out of business hours, throttled to 1/chat/hour). Triggered by a queued `automsg.maybe` job whenever a business workspace receives a 1:1 message. |
| **Labels** | Workspace-scoped colored tags (`Label` model) applied to chats to organize customers. Managers create; any member applies. |
| **Quick replies** | Canned `/shortcut` → text responses (`QuickReply` model), looked up live in the composer. |
| **Broadcast lists** | `BroadcastList` of up to 256 **mutual contacts**. One send delivers the message into each recipient's own 1:1 chat individually — recipients never see each other; reports sent/skipped counts. |

---

## 9. Workspaces / Multi-tenancy

- Every user belongs to a `Workspace`: the shared **Personal** space (consumer tenant), or a **team** workspace (created at signup with `accountType: 'workspace'`, or joined via `?invite=` code).
- Roles: **owner / admin / member** (`workspaceRole` on `User`), enforced by the RBAC matrix.
- **Management** (Settings → Workspace): rename, business profile, **invite link copy + rotate**, member roster with **role change**, **transfer ownership** (owner → admin, promotes target), **suspend/reactivate** (revokes sessions), and **remove member** (ejected from all workspace chats, contacts scrubbed, moved to a fresh personal workspace, sessions revoked).
- An idempotent boot migration (`ensureWorkspaces`) attaches orphan users/chats to a default workspace.

---

## 10. Notifications

- **In-app:** persisted `Notification` docs power the bell dropdown (`GET /notifications` + unread count, mark one/all read); clicking a notification deep-links to the relevant page.
- **Web Push:** per-device opt-in via service worker (`/sw.js`) + VAPID (`GET /push/key`, `POST /push/subscribe` — SSRF-guarded to known push hosts, max 20 subscriptions/user). Dead subscriptions (404/410) are auto-pruned; the whole feature no-ops gracefully without VAPID keys.
- **Unified dispatch:** `utils/notify.js` `notifyUser()` enqueues `notification.create` + `push.send` jobs off the request path.
- **Desktop notifications** for incoming calls when the browser tab is unfocused.
- Per-category preference toggles (messages / groups / calls / meetings / sounds) in Settings.
- **Presence / Do-Not-Disturb** (`presenceState`: available / away / busy / dnd, `PATCH /users/me/presence`, live `presence-state` socket event). DND suppresses Web Push + desktop alerts (the in-app bell still records everything).
- **Incoming webhooks:** a group member mints a secret ingress URL (`POST /api/webhooks`); an external service posts `{ text }` to `POST /api/hooks/:token` (no session — the token is the credential) and it lands as a labeled message in the group. Managed from the Developers page; revocable.

---

## 11. Admin & Moderation

- **Admin dashboard** (`/admin`, platform-admin only): stat cards (users, active, groups, messages, calls, open reports), user-growth area chart + message-volume bar chart (7-day aggregations), live online count.
- **User management:** search users, set status active / suspended / **banned** (bumps `tokenVersion` to kill all sessions; self-ban blocked).
- **Moderation reports:** users file reports against users/groups/messages/statuses (`POST /api/reports`); admins resolve/dismiss from a queue.
- **Security logging:** structured JSON events to stdout for logins, admin actions, API-key use, two-step and password changes (`middleware/securityLog.js`).

---

## 12. Developer / Public API

- **Scoped API keys** (admin-only, `/developers` page + Settings → Developer): create keys with scopes (`chat:read/write`, `contacts:read`, `calls:write`, `meetings:read/write`); secret shown **once**, hashed at rest (`ApiKey` model stores prefix + hash), revocable, max 20/user.
- **Public REST API** at `/api/v1`, authenticated with the `X-API-Key` header (`apiKeyAuth` middleware, **120 req/min per key**). Keys act as their owner through the same secured controllers. Endpoints: `/me`, `/contacts`, `/users/search`, `/chats`, `/chats/direct/:userId`, `/messages/:chatId`, `POST /messages`, `POST /calls`, `/meetings`, `POST /meetings`.
- In-app docs: base URL, auth header, rate limits, endpoint table, curl quickstart.

---

## 13. Media & Uploads

- `POST /api/upload`: multer, ≤10 files, 50MB cap, extension-anchored allowlist.
- **Pluggable storage driver** (`STORAGE_DRIVER`): `local` (disk under `server/uploads/`) or `cloudinary` (CDN — required for multi-instance deployments).
- **Media is not public-by-URL:** `GET /uploads/:filename` requires a valid short-lived **media-scoped token** (`GET /upload/access`, 6h) and enforces authorization at serve time — chat attachments require chat membership, status media enforces the status audience, avatars are readable by any authenticated user. Path traversal is guarded.
- The client appends media tokens automatically (`ensureMediaToken` / `mediaUrl` in `client/src/lib/api.js`); avatars are stored as small data-URLs so they render without a token.

---

## 14. Security & Infrastructure (cross-cutting)

### Security middleware
- **RBAC** (`server/utils/rbac.js`): one permission matrix spanning platform (`User.role`), workspace (`workspaceRole`), and group (participant role) dimensions; platform admin overrides all.
- **CSRF guard** (`middleware/csrf.js`): Origin/Referer allowlist shared with CORS; blocks cross-site mutations with a clean 403; permissive on localhost/LAN in dev.
- **Rate limiting:** global 1000/15min, auth 40/15min, per-API-key 120/min — Redis-backed shared store when configured.
- **NoSQL-injection sanitizer** (recursive operator scrub of body/query/params), CSP headers, JWT algorithm pinning (HS256), scoped tokens rejected by both HTTP `protect` and the socket handshake.
- **Error handling:** normalized Mongoose/JWT errors; 5xx internals hidden in production.

### Scaling flags (everything degrades gracefully when unset)
| Env var | Enables |
|---|---|
| `REDIS_URL` | Socket.IO Redis adapter (cross-instance fan-out), shared rate-limit store, response cache (catalog), durable **BullMQ** job queue (notifications, push, auto-replies; retried, concurrency 10). Unset → in-memory / inline in-process. |
| `STORAGE_DRIVER` + `CLOUDINARY_*` | Cloud media storage (needed for horizontal scale). |
| `VAPID_*` | Web Push. |
| `EMAIL_*` / `SMTP_*` / `BREVO_API_KEY` | Email (Brevo HTTPS API takes priority — for hosts that block SMTP ports). |
| `LIVEKIT_URL` + `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` | Route meeting media through the LiveKit SFU (scales rooms past the mesh's ~6-peer limit). Unset → in-browser full mesh. |
| `TWILIO_*` | Optional SMS login OTP. |
| `ENABLE_EMAIL_VERIFICATION`, `JWT_SECRET` (prod boot fails if weak), `JWT_ACCESS_EXPIRES`, `REFRESH_TOKEN_DAYS`, `SESSION_IDLE_DAYS`, `CLIENT_URL` / `EXTRA_CORS_ORIGINS` | Auth/session tuning and CORS. |

### Background work
- **No cron.** All time-based cleanup uses **MongoDB TTL indexes**: disappearing messages, 24h statuses, sessions, email-verification records. Meeting lifecycle is driven by socket join/leave/disconnect.
- Boot tasks: fan-out job registration, queue init, workspace migration, SMTP verification. Graceful SIGTERM/SIGINT shutdown.

---

## 15. Client App Shell & Routing

### Routes
| Route | Page |
|---|---|
| `/login`, `/signup`, `/forgot-password`, `/reset-password/:token`, `/verify-otp` | Auth pages (public) |
| `/meet/:code` | Meeting room (full-screen, outside shell) |
| `/` | Chats (sidebar + conversation) |
| `/calls`, `/meetings`, `/status`, `/groups`, `/communities`, `/broadcasts`, `/contacts`, `/settings` | Feature pages |
| `/business` | Business tools (team workspaces only) |
| `/developers`, `/admin` | Admin-only (guarded by `AdminRoute`) |

### Shell behaviors
- **Route guards:** `ProtectedRoute` redirects to login; shows the two-step `LockScreen` once per browser session when enabled.
- **Code-splitting:** only Login + AppLayout + ChatsPage load eagerly; every other page is lazy.
- **Layout:** desktop nav rail + top bar (global search, new chat, theme toggle, notification bell, profile) + mobile bottom nav (with total-unread badge); `CallOverlay` and busy-call banner mounted app-wide; error boundary resets on navigation.
- **Theming:** light / dark / system (reacts to OS) + 6 accent colors, hydrated per-user from account settings and reset on logout.
- **Demo mode** (`VITE_DEMO_MODE`): swaps all API/socket calls for in-memory mock data — the entire UI is explorable offline (any login works, fake peers auto-reply, calls preview your local camera).
- **Auth resilience:** single-flight token refresh on 401 with request replay; forced logout event on unrecoverable auth failure.

---

## 16. Realtime Socket Events Reference

**Handshake:** JWT validated (media-scoped tokens rejected), account status + `tokenVersion` + `Session` re-checked; socket joins its `user:<id>` room. Presence tracked in-memory, cross-instance via the Redis adapter.

| Category | Events |
|---|---|
| Rooms | `join-chat` (membership-verified), `leave-chat` |
| Messaging | `receive-message`, `chat-updated`, `message-edited`, `message-updated` (polls/in-place), `message-deleted`, `message-reaction`, `message-pinned`, `chat-disappearing` |
| Receipts | `message:delivered` → `message:status`; `message:read` (persists + respects read-receipt privacy) |
| Typing / presence | `typing-start`, `typing-stop`, `presence-snapshot`, `user-online`, `user-offline` |
| Groups | `group-updated` (rename/avatar/members/roles) |
| Contacts / status | `contact-request`, `contact-accepted`, `status-reply` |
| Live location | `live-location`, `live-location-stopped` |
| Calls | `call:invite`, `call:incoming`, `call:accept(ed)`, `call:reject(ed)`, `call:busy`, `call:cancel(led)`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:screen`, `call:end(ed)`, `call:handled`, `call:unavailable` — gated by mutual contacts or shared group |
| Meetings | `meeting-invited`; room events `meeting:join`, `meeting:leave`, `meeting:signal` (SDP/ICE relay), `meeting:peer-joined`, `meeting:peer-left`, `meeting:presenting`, `meeting:chat`, `meeting:reaction`, `meeting:hand`, `meeting:mute-all`, `meeting:force-mute`, `meeting:remove(d)` |
| Presence (manual) | `presence-state` (available/away/busy/dnd) |

---

### Key file map

| Area | Files |
|---|---|
| Server entry | `server/server.js`, `server/routes/index.js` |
| Socket layer | `server/socket/index.js` |
| Auth / RBAC | `server/middleware/auth.js`, `server/utils/rbac.js`, `server/utils/token.js`, `server/utils/session.js` |
| Services | `server/utils/callService.js`, `server/utils/autoReply.js`, `server/utils/workspaceService.js`, `server/utils/notify.js`, `server/utils/privacy.js` |
| Scaling | `server/utils/jobs.js`, `server/utils/queue.js`, `server/utils/redis.js`, `server/utils/cache.js`, `server/utils/push.js`, `server/utils/storage.js` |
| Client entry | `client/src/main.jsx`, `client/src/App.jsx`, `client/src/lib/api.js` |
| Chat UI | `client/src/components/chat/` (ChatArea, MessageBubble, MessageComposer, ChatSidebar, RightPanel) |
| Realtime | `client/src/hooks/useSocket.js`, `useWebRTC.js`, `useMeetingRoom.js` |
| State | `client/src/store/` (useChat, useAuth, useContacts, useMeetings, useStatus, useBusiness, useWorkspace, useCommunities, useBroadcasts, useNotifications, useUI) |

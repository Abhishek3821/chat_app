# ChatKonect — Backend API Reference

> **Generated from source** by `server/tests/gen-api-docs.mjs`. Re-run it after any
> route change; do not hand-edit the endpoint tables below. Every path, method,
> auth requirement and body field here was read out of `server/routes/` and
> `server/controllers/`, so this cannot silently disagree with the code.
>
> **184 endpoints across 28 routers.**

---

## 1. Base URL

| Environment | Base URL |
|---|---|
| Production | `https://<your-backend-host>/api` |
| Local | `http://localhost:5000/api` |

Every path in this document is relative to that base — so `POST /auth/login`
means `POST https://<host>/api/auth/login`.

A health probe is available un-authenticated at `GET /api/health`. Free-tier
hosts sleep idle instances, so the first request after idle can take ~50 s; ping
`/health` on app start to warm it up.

## 2. Authentication

Three separate credential types. Most of the API uses the first.

| Type | Header | Used by |
|---|---|---|
| **Session** (access token) | `Authorization: Bearer <accessToken>` | Normal app requests |
| **API key** | `X-API-Key: <key>` | Server-to-server `/v1` integrations |
| **App secret** | `X-CC-App-Id` + `Authorization: Bearer <appSecret>` | Embedded-platform provisioning ([PLATFORM.md](PLATFORM.md)) |

### Getting a session

```http
POST /api/auth/login
Content-Type: application/json

{ "identifier": "ada@example.com", "password": "…" }
```

`identifier` accepts an **email, username or phone**. The response carries
`accessToken` (short-lived, send it as the Bearer token) and sets a refresh
cookie. When a request returns **401**, call `POST /api/auth/refresh` once and
retry; if that also fails, the session is gone and the user must sign in again.

Signup is a three-step flow, because the email is verified *before* the account
exists:

1. `POST /auth/email/send-code` → emails a 6-digit code
2. `POST /auth/email/verify-code` → returns an `emailToken` proof
3. `POST /auth/signup` with that `emailToken` → creates the account and returns a session

> **Mobile note:** the web client keeps the access token in `localStorage`. On a
> native app use the platform secure store (Keychain / Keystore), and send the
> same `Authorization: Bearer` header.

## 3. Response and error shape

Success responses always include `success: true` plus the payload:

```json
{ "success": true, "user": { "…": "…" } }
```

Errors are uniform — parse `message` and show it; the strings are written for
end users:

```json
{ "success": false, "message": "Send a contact request and get accepted before you can chat." }
```

| Status | Meaning |
|---|---|
| `400` | Validation — the message names the offending field |
| `401` | No/expired session → refresh once, then re-authenticate |
| `403` | Authenticated but not permitted (not a member, not the host, feature off) |
| `404` | Not found, or not visible to you |
| `409` | Conflict (duplicate, or an action invalid in the current state) |
| `413` | Upload too large (50 MB per file) |
| `429` | Rate limited — back off and retry |

## 4. Conventions

**Pagination** is cursor-based on the message endpoints: pass
`?before=<ISO timestamp>&limit=40`. A page shorter than `limit` means you have
reached the start of the conversation. Do not page with offsets.

**IDs** are Mongo ObjectId strings (24 hex chars).

**Realtime.** Most state changes also emit a Socket.IO event, and a well-behaved
client listens rather than polling. Connect to the same origin with
`auth: { token: accessToken }`. The full event list is in
[SOCKET_EVENTS.md](SOCKET_EVENTS.md) — read it alongside this file, because
several features (presence, typing, receipts, calls) are realtime-only.

**Feature flags.** Routers marked *Feature* below are disabled per tenant on the
embedded platform and return `403` when the tenant lacks the flag. First-party
accounts are never feature-gated.

---

## 5. Endpoints

| Router | Base path | Endpoints | Auth |
|---|---|---|---|
| [adminRoutes](#admin) | `/admin` | 5 | Session, **Admin** |
| [agentRoutes](#agent) | `/agent` | 9 | Session |
| [appRoutes](#apps) | `/apps` | 6 | Session |
| [authRoutes](#auth) | `/auth` | 21 | — |
| [broadcastRoutes](#broadcasts) | `/broadcasts` | 5 | Session |
| [callRoutes](#calls) | `/calls` | 8 | Session |
| [catalogRoutes](#catalog) | `/catalog` | 6 | Session |
| [chatRoutes](#chats) | `/chats` | 9 | Session |
| [communityRoutes](#communities) | `/communities` | 6 | Session |
| [contactRoutes](#contacts) | `/contacts` | 3 | Session |
| [groupRoutes](#groups) | `/groups` | 7 | Session |
| [webhookRoutes](#hooks) | `/hooks` | 4 | Session |
| [keyRoutes](#keys) | `/keys` | 3 | Session, **Admin** |
| [liveLocationRoutes](#live-location) | `/live-location` | 4 | Session |
| [meetingRoutes](#meetings) | `/meetings` | 10 | Session |
| [messageRoutes](#messages) | `/messages` | 19 | Session |
| [notificationRoutes](#notifications) | `/notifications` | 3 | Session |
| [pushRoutes](#push) | `/push` | 3 | Session |
| [reportRoutes](#reports) | `/reports` | 1 | Session |
| [searchRoutes](#search) | `/search` | 1 | Session |
| [statusRoutes](#status) | `/status` | 6 | Session |
| [uploadRoutes](#upload) | `/upload` | 2 | Session |
| [userRoutes](#users) | `/users` | 15 | Session |
| [v1Routes](#v1) | `/v1` | 10 | — |
| [embedRoutes](#v1-embed) | `/v1/embed` | 2 | — |
| [platformRoutes](#v1-platform) | `/v1/platform` | 5 | App secret |
| [webhookRoutes](#webhooks) | `/webhooks` | 4 | Session |
| [workspaceRoutes](#workspaces) | `/workspaces` | 7 | Session |

---

### `/admin`

**Auth:** Session + **Admin** · **Source:** `server/routes/adminRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/admin/stats` | — | GET /api/admin/stats |
| `GET` | `/admin/users` | — | GET /api/admin/users?q= |
| `PATCH` | `/admin/users/:id/status` | `accountStatus` | PATCH /api/admin/users/:id/status { accountStatus } |
| `GET` | `/admin/reports` | — | GET /api/admin/reports |
| `PATCH` | `/admin/reports/:id` | `status` | PATCH /api/admin/reports/:id { status } |

### `/agent`

agent tools: labels + quick replies

**Auth:** Session · **Source:** `server/routes/agentRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/agent/labels` | — | ── Labels ─────────────────────────────────────────────────────── GET /api/agent/labels |
| `POST` | `/agent/labels` | `name`, `color` | POST /api/agent/labels { name, color } |
| `GET` | `/agent/labels/chat/:chatId` | — | labels applied to a chat (my workspace's only) |
| `POST` | `/agent/labels/:id/apply` | `chatId`, `apply` | tag a chat (any workspace member) |
| `DELETE` | `/agent/labels/:id` | — | DELETE /api/agent/labels/:id |
| `GET` | `/agent/quick-replies` | — | ── Quick replies ──────────────────────────────────────────────── GET /api/agent/quick-replies |
| `POST` | `/agent/quick-replies` | `shortcut`, `text` | POST /api/agent/quick-replies { shortcut, text } |
| `PATCH` | `/agent/quick-replies/:id` | `shortcut`, `text` | PATCH /api/agent/quick-replies/:id |
| `DELETE` | `/agent/quick-replies/:id` | — | DELETE /api/agent/quick-replies/:id |

### `/apps`

embeddable-platform TENANT management (admin console)

**Auth:** Session · **Source:** `server/routes/appRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/apps/:id/stats` | — | live counts for the console (users are counted here rather than trusted from the cached counter). |
| `POST` | `/apps/:id/rotate` | — | Must be real http(s) origins. |
| `GET` | `/apps` | — | ───────────────────────── Admin-side (dashboard) ───────────────────────── These are session-authenticated (`protect`), not app-secret authenticated — they're what the ChatKonect admin console uses to create and manage tenants. |
| `POST` | `/apps` | `name`, `features` | create a tenant. |
| `PATCH` | `/apps/:id` | `name`, `active`, `features`, `allowedOrigins`, `limits` | rename, toggle features/limits/origins, enable/disable. |
| `DELETE` | `/apps/:id` | — | disable a tenant. |

### `/auth`

**Auth:** varies per route — see the **Auth** column · **Source:** `server/routes/authRoutes.js`

| Method | Path | Auth | Body / notes | Description |
|---|---|---|---|---|
| `POST` | `/auth/email/send-code` | public | `email` · _rate limited_ | Step 1 of signup: send a verification code to the address BEFORE any account exists. |
| `POST` | `/auth/email/verify-code` | public | `email`, `otp` · _rate limited_ | → { emailToken } Step 2 of signup: check the code; on success return a short-lived signed proof the client must include in the final signup request. |
| `POST` | `/auth/signup` | public | `name`, `email`, `password`, `confirmPassword`, `phone`, `emailToken`, `inviteCode`, `invite`, `accountType`, `username`, `avatar`, `workspaceName` · _rate limited_ | POST /api/auth/signup |
| `POST` | `/auth/verify-otp` | public | `email`, `otp` · _rate limited_ | POST /api/auth/verify-otp |
| `POST` | `/auth/resend-otp` | public | `email` · _rate limited_ | POST /api/auth/resend-otp |
| `POST` | `/auth/login` | public | `identifier`, `email`, `password` · _rate limited_ | Single-step sign-in: email/username/phone + password → session. |
| `POST` | `/auth/logout` | Session | — | revoke THIS session (not just clear the cookie). |
| `POST` | `/auth/refresh` | public | _rate limited_ | rotate the refresh token and mint a fresh access token. |
| `GET` | `/auth/me` | Session | — | GET /api/auth/me |
| `GET` | `/auth/sessions` | Session | — | the caller's active devices/sessions. |
| `POST` | `/auth/sessions/revoke-others` | Session | — | log out every device except this one. |
| `DELETE` | `/auth/sessions/:id` | Session | — | revoke one session (log out that device). |
| `POST` | `/auth/forgot-password` | public | `email` · _rate limited_ | POST /api/auth/forgot-password |
| `POST` | `/auth/reset-password/:token` | public | `password` · _rate limited_ | POST /api/auth/reset-password/:token |
| `PATCH` | `/auth/change-password` | Session | `currentPassword`, `newPassword` | PATCH /api/auth/change-password |
| `POST` | `/auth/two-step/enable` | Session | `pin` | POST /api/auth/two-step/enable { pin } |
| `POST` | `/auth/two-step/change` | Session | `currentPin`, `newPin` · _rate limited_ | rotate the PIN. |
| `POST` | `/auth/two-step/disable` | Session | `pin` | POST /api/auth/two-step/disable { pin } |
| `POST` | `/auth/two-step/verify` | Session | `pin` · _rate limited_ | unlock this session (rate-limited). |
| `POST` | `/auth/two-step/forgot` | Session | _rate limited_ | email an OTP that lets the user reset a forgotten app-lock / chat-lock PIN. |
| `POST` | `/auth/two-step/reset` | Session | `pin`, `otp` · _rate limited_ | verify the emailed OTP and set a new PIN. |

### `/broadcasts`

broadcast lists (one-to-many DMs)

**Auth:** Session · **Source:** `server/routes/broadcastRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/broadcasts` | — | GET /api/broadcasts |
| `POST` | `/broadcasts` | `name`, `recipients` | POST /api/broadcasts { name, recipients: [userId] } |
| `POST` | `/broadcasts/:id/send` | `content`, `type`, `attachments` | Delivers the message individually to each recipient's own 1:1 chat. |
| `PATCH` | `/broadcasts/:id` | `name`, `recipients` | PATCH /api/broadcasts/:id { name, recipients } |
| `DELETE` | `/broadcasts/:id` | — | DELETE /api/broadcasts/:id |

### `/calls`

**Auth:** Session · **Source:** `server/routes/callRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/calls` | — | and GET /api/calls/history — call history for the user |
| `GET` | `/calls/history` | — | and GET /api/calls/history — call history for the user |
| `POST` | `/calls/start` | `receiverId`, `callType`, `type` | Creates the 1:1 call record BEFORE signaling rings the callee, and tells the caller whether the receiver is even online (offline → logged as missed). |
| `POST` | `/calls/end` | `callId`, `duration` | POST /api/calls/end { callId, duration? |
| `POST` | `/calls/missed` | `callId` | POST /api/calls/missed { callId } |
| `POST` | `/calls/reject` | `callId` | POST /api/calls/reject { callId } |
| `POST` | `/calls` | `type`, `chatId`, `participants`, `isGroup` | legacy/group entry point: log a call and ring the callees |
| `PATCH` | `/calls/:id` | `status`, `duration` | legacy: update status/duration when call ends |

### `/catalog`

WhatsApp-Business product catalog

**Auth:** Session · **Source:** `server/routes/catalogRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/catalog/mine` | — | my workspace's catalog (+ whether I can edit it) |
| `POST` | `/catalog` | `name`, `images`, `description`, `price`, `currency`, `link`, `inStock` | add a product (manager) |
| `POST` | `/catalog/:id/share` | `chatId` | share a product into a chat as a message |
| `PATCH` | `/catalog/:id` | `name`, `description`, `price`, `currency`, `link`, `inStock`, `images` | edit a product (manager, own workspace only) |
| `DELETE` | `/catalog/:id` | — | remove a product (manager) |
| `GET` | `/catalog/:workspaceId` | — | browse any business's catalog (any signed-in user) |

### `/chats`

**Auth:** Session · **Source:** `server/routes/chatRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/chats` | — | all conversations for the current user (locked chats hidden; they surface only via POST /api/chats/locked after the PIN is entered) |
| `POST` | `/chats/locked` | `pin` | reveal locked chats after verifying the PIN |
| `POST` | `/chats/direct/:userId` | — | get-or-create a 1:1 chat |
| `POST` | `/chats/:id/lock` | — | hide a chat behind the two-step PIN (chat lock). |
| `POST` | `/chats/:id/unlock` | — | move a chat back to the main list |
| `GET` | `/chats/:id` | — | GET /api/chats/:id |
| `PATCH` | `/chats/:id/disappearing` | `seconds` | 0 turns it off. |
| `DELETE` | `/chats/:id/clear` | — | clear messages for me only |
| `DELETE` | `/chats/:id` | — | leave/remove chat for the user |

### `/communities`

groups-of-groups + announcements

**Auth:** Session · **Source:** `server/routes/communityRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/communities` | `name`, `description` | POST /api/communities { name, description } |
| `GET` | `/communities` | — | communities I belong to |
| `POST` | `/communities/join/:inviteCode` | — | join a community |
| `GET` | `/communities/:id` | — | details + linked groups (members only) |
| `POST` | `/communities/:id/groups` | `name` | create a new group inside the community (admin) |
| `POST` | `/communities/:id/leave` | — | POST /api/communities/:id/leave |

### `/contacts`

**Auth:** Session · **Source:** `server/routes/contactRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/contacts/requests` | — | GET /api/contacts/requests |
| `POST` | `/contacts/request/:userId` | `message` | POST /api/contacts/request/:userId |
| `PATCH` | `/contacts/request/:id` | `action` | PATCH /api/contacts/request/:id { action: 'accept'\|'reject' } |

### `/groups`

**Auth:** Session · **Source:** `server/routes/groupRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/groups` | `name`, `description`, `avatar`, `members` | POST /api/groups |
| `POST` | `/groups/join/:inviteCode` | — | POST /api/groups/join/:inviteCode |
| `PATCH` | `/groups/:id` | — | PATCH /api/groups/:id |
| `POST` | `/groups/:id/members` | `members` | POST /api/groups/:id/members { members: [ids] } |
| `DELETE` | `/groups/:id/members/:userId` | — | remove a member from the workspace (owner/admin) Ejects them: pulled from this workspace's group chats and moved to a fresh personal workspace of their own, with sessions revoked so it takes effect at once. |
| `PATCH` | `/groups/:id/members/:userId/role` | `role` | owner/admin sets a member's org role |
| `POST` | `/groups/:id/leave` | — | POST /api/groups/:id/leave |

### `/hooks`

PUBLIC token-authed message ingress

**Auth:** Session · **Source:** `server/routes/webhookRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/hooks` | — | my webhooks across the groups I'm in. |
| `POST` | `/hooks` | `chatId`, `label` | mint a webhook for a group I'm in. |
| `DELETE` | `/hooks/:id` | — | revoke one of my group's webhooks. |
| `POST` | `/hooks/:token` | _rate limited_ | PUBLIC (the token is the credential). |

### `/keys`

manage your own API keys (JWT)

**Auth:** Session + **Admin** · **Source:** `server/routes/keyRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/keys` | — | list my keys (never returns the secret, only the prefix). |
| `POST` | `/keys` | `label`, `scopes` | create a key. |
| `DELETE` | `/keys/:id` | — | revoke one of my keys. |

### `/live-location`

real-time location sharing

**Auth:** Session · **Source:** `server/routes/liveLocationRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/live-location/start` | `chatId`, `lat`, `lng`, `durationSecs` | Anchors a live-location message in the chat that updates until it expires. |
| `GET` | `/live-location/:chatId/active` | — | currently-live shares in a chat |
| `POST` | `/live-location/:messageId/update` | `lat`, `lng` | sharer only, realtime |
| `POST` | `/live-location/:messageId/stop` | — | sharer stops sharing early |

### `/meetings`

**Auth:** Session · **Source:** `server/routes/meetingRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/meetings` | — | Get meetings _(from handler name)_ |
| `POST` | `/meetings` | — | Create meeting _(from handler name)_ |
| `GET` | `/meetings/code/:code` | — | Get meeting by code _(from handler name)_ |
| `GET` | `/meetings/code/:code/rtc` | — | Get meeting rtc _(from handler name)_ |
| `POST` | `/meetings/code/:code/join` | — | Join meeting by code _(from handler name)_ |
| `GET` | `/meetings/:id/report` | — | Get meeting report _(from handler name)_ |
| `PATCH` | `/meetings/:id` | — | Update meeting _(from handler name)_ |
| `POST` | `/meetings/:id/rsvp` | `response` | POST /api/meetings/:id/rsvp { response } |
| `POST` | `/meetings/:id/invite` | `userIds`, `emails` | Look a meeting up by its shareable room code OR its raw id ("join by meeting ID"). |
| `DELETE` | `/meetings/:id` | — | (cancel) |

### `/messages`

**Auth:** Session · **Source:** `server/routes/messageRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/messages` | — | Send message _(from handler name)_ |
| `POST` | `/messages/poll` | `chatId`, `question`, `options`, `multi` | POST /api/messages/poll { chatId, question, options[], multi } |
| `POST` | `/messages/read` | — | PATCH /api/notifications/:id/read |
| `GET` | `/messages/starred` | — | Keep only well-formed attachments whose URL is our own upload or an https URL (blocks data:/javascript:/relative-path injection that a client could auto-load). |
| `POST` | `/messages/schedule` | `chatId`, `content`, `type`, `replyTo`, `location`, `mentions`, `sendAt` | POST /api/messages/schedule |
| `GET` | `/messages/scheduled/:chatId` | — | my own pending items for this chat |
| `DELETE` | `/messages/scheduled/:id` | — | DELETE /api/messages/scheduled/:id |
| `GET` | `/messages/:chatId` | — | Get messages _(from handler name)_ |
| `GET` | `/messages/:chatId/search` | — | Searches the WHOLE conversation. |
| `GET` | `/messages/:chatId/pins` | — | the live pins with their messages. |
| `GET` | `/messages/:chatId/context/:messageId` | — | Membership gate. |
| `PATCH` | `/messages/:id` | — | Edit message _(from handler name)_ |
| `DELETE` | `/messages/:id` | — | Delete message _(from handler name)_ |
| `POST` | `/messages/:id/react` | — | React to message _(from handler name)_ |
| `POST` | `/messages/:id/star` | — | Toggle star _(from handler name)_ |
| `POST` | `/messages/:id/pin` | `hours` | (toggle at chat level) POST /api/messages/:id/pin { hours: 1 \| 6 \| 12 \| 24 } Pins a message for everyone in the chat until it expires. |
| `DELETE` | `/messages/:id/pin` | — | unpin early. |
| `POST` | `/messages/:id/vote` | `optionIndex` | POST /api/messages/:id/vote { optionIndex } |
| `POST` | `/messages/:id/viewed` | — | consume a view-once message. |

### `/notifications`

**Auth:** Session · **Source:** `server/routes/notificationRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/notifications` | — | GET /api/notifications |
| `PATCH` | `/notifications/read` | — | mark all read |
| `PATCH` | `/notifications/:id/read` | — | PATCH /api/notifications/:id/read |

### `/push`

Web Push subscriptions (notifications)

**Auth:** Session · **Source:** `server/routes/pushRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/push/key` | — | the VAPID public key the browser needs to subscribe. |
| `POST` | `/push/subscribe` | — | } } |
| `POST` | `/push/unsubscribe` | — | POST /api/push/unsubscribe { endpoint } |

### `/reports`

**Auth:** Session · **Source:** `server/routes/reportRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/reports` | `targetType`, `targetUser`, `targetChat`, `targetMessage`, `reason`, `description` | POST /api/reports |

### `/search`

one search across people/chats/messages/meetings

**Auth:** Session · **Source:** `server/routes/searchRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/search` | — | Global search _(from handler name)_ |

### `/status`

**Auth:** Session · **Source:** `server/routes/statusRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/status` | — | my status + contacts' statuses, grouped by user |
| `POST` | `/status` | `type`, `content`, `media`, `background`, `privacy` | POST /api/status |
| `POST` | `/status/:id/view` | — | POST /api/status/:id/view |
| `POST` | `/status/:id/reply` | `text` | POST /api/status/:id/reply { text } |
| `GET` | `/status/:id/viewers` | — | GET /api/status/:id/viewers |
| `DELETE` | `/status/:id` | — | DELETE /api/status/:id |

### `/upload`

**Auth:** Session · **Source:** `server/routes/uploadRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `POST` | `/upload` | _multipart_ · _multipart_ | (multipart, field: "files") Returns attachment descriptors. |
| `GET` | `/upload/access` | — | (protected) — mint a short-lived, media-only token the client appends to <img>/<video> src URLs (so the 30-day session JWT never ends up in a URL / browser history / referrer). |

### `/users`

**Auth:** Session · **Source:** `server/routes/userRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/users/search` | — | GET /api/users/search?q= |
| `PATCH` | `/users/me` | — | PATCH /api/users/me |
| `PATCH` | `/users/me/privacy` | — | Update privacy _(from handler name)_ |
| `PATCH` | `/users/me/presence` | — | Update presence _(from handler name)_ |
| `PATCH` | `/users/me/settings` | — | Update settings _(from handler name)_ |
| `GET` | `/users/me/export` | — | a downloadable JSON archive of the user's own data. |
| `DELETE` | `/users/me` | — | GDPR-style erasure: remove the account AND the data it produced / references to it, instead of leaving orphaned PII behind. |
| `GET` | `/users/me/contacts` | — | Get contacts _(from handler name)_ |
| `POST` | `/users/me/contacts/:id` | — | Add contact _(from handler name)_ |
| `DELETE` | `/users/me/contacts/:id` | — | Allowed shapes per privacy key. |
| `POST` | `/users/me/favorites/:id` | — | Toggle favorite _(from handler name)_ |
| `POST` | `/users/me/block/:id` | — | Toggle block _(from handler name)_ |
| `PUT` | `/users/me/chats/:chatId/theme` | `wallpaper`, `bubble` | Tell the other side live, so their contact list and any open chat header update without a reload — the same standard every other mutation here meets. |
| `POST` | `/users/me/chats/:chatId/:action` | — | Toggle chat flag _(from handler name)_ |
| `GET` | `/users/:id` | — | GET /api/users/:id |

### `/v1`

public third-party API (X-API-Key)

**Auth:** varies per route — see the **Auth** column · **Source:** `server/routes/v1Routes.js`

| Method | Path | Auth | Body / notes | Description |
|---|---|---|---|---|
| `GET` | `/v1/me` | API key | — | _handled inline in the route file_ |
| `GET` | `/v1/contacts` | API key: `contacts:read` | — | Get contacts _(from handler name)_ |
| `GET` | `/v1/users/search` | API key: `contacts:read` | — | GET /api/users/search?q= |
| `GET` | `/v1/chats` | API key: `chat:read` | — | all conversations for the current user (locked chats hidden; they surface only via POST /api/chats/locked after the PIN is entered) |
| `POST` | `/v1/chats/direct/:userId` | API key: `chat:write` | — | get-or-create a 1:1 chat |
| `GET` | `/v1/messages/:chatId` | API key: `chat:read` | — | Get messages _(from handler name)_ |
| `POST` | `/v1/messages` | API key: `chat:write` | — | Send message _(from handler name)_ |
| `POST` | `/v1/calls` | API key: `calls:write` | `type`, `chatId`, `participants`, `isGroup` | legacy/group entry point: log a call and ring the callees |
| `GET` | `/v1/meetings` | API key: `meetings:read` | — | Get meetings _(from handler name)_ |
| `POST` | `/v1/meetings` | API key: `meetings:write` | — | Create meeting _(from handler name)_ |

### `/v1/embed`

**Auth:** varies per route — see the **Auth** column · **Source:** `server/routes/embedRoutes.js`

| Method | Path | Auth | Body / notes | Description |
|---|---|---|---|---|
| `GET` | `/v1/embed/config` | public | — | GET /api/v1/embed/config?appId=app_xxx |
| `GET` | `/v1/embed/ice` | Session | — | requires a user token (`protect` runs first) |

### `/v1/platform`

tenant backend: provision users + mint user tokens

**Auth:** App secret · **Source:** `server/routes/platformRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/v1/platform/whoami` | — | _handled inline in the route file_ |
| `POST` | `/v1/platform/users` | `externalId`, `name`, `avatar`, `bio` | The platform API a host product's BACKEND talks to (app-secret authenticated). |
| `GET` | `/v1/platform/users` | — | page through this tenant's provisioned users. |
| `DELETE` | `/v1/platform/users/:externalId` | — | revoke access for one end user. |
| `POST` | `/v1/platform/tokens` | `externalId` | mint a short-lived token for one end user. |

### `/webhooks`

manage incoming webhooks (group members)

**Auth:** Session · **Source:** `server/routes/webhookRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/webhooks` | — | my webhooks across the groups I'm in. |
| `POST` | `/webhooks` | `chatId`, `label` | mint a webhook for a group I'm in. |
| `DELETE` | `/webhooks/:id` | — | revoke one of my group's webhooks. |
| `POST` | `/webhooks/:token` | _rate limited_ | PUBLIC (the token is the credential). |

### `/workspaces`

multi-tenant org management

**Auth:** Session · **Source:** `server/routes/workspaceRoutes.js`

| Method | Path | Body / notes | Description |
|---|---|---|---|
| `GET` | `/workspaces/me` | — | my workspace + members (invite code only for managers) |
| `PATCH` | `/workspaces/me` | `name`, `businessProfile`, `autoReplies` | rename (owner/admin) |
| `POST` | `/workspaces/me/invite/rotate` | — | new invite code (owner/admin) |
| `POST` | `/workspaces/me/transfer` | `userId` | hand ownership to another member. |
| `PATCH` | `/workspaces/me/members/:userId/role` | `role` | owner/admin sets a member's org role |
| `PATCH` | `/workspaces/me/members/:userId/status` | `status` | pause/reactivate a member (owner/admin) "Pause" suspends the member's access and revokes their live sessions; setting 'active' lifts it. |
| `DELETE` | `/workspaces/me/members/:userId` | — | remove a member from the workspace (owner/admin) Ejects them: pulled from this workspace's group chats and moved to a fresh personal workspace of their own, with sessions revoked so it takes effect at once. |

---

## 6. Where to look next

| Topic | Document |
|---|---|
| Every realtime event, both directions, plus call-signalling order | [SOCKET_EVENTS.md](SOCKET_EVENTS.md) |
| Token lifetimes, refresh rotation, sessions, two-step PIN | [AUTHENTICATION.md](AUTHENTICATION.md) |
| Upload limits, accepted types, how protected media is fetched | [FILE_UPLOADS.md](FILE_UPLOADS.md) |
| Schemas and relationships behind these payloads | [DATABASE_MODELS.md](DATABASE_MODELS.md) |
| Feature rules and the "why" behind the constraints | [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) |
| Embedding ChatKonect in another product (tenants, user tokens) | [PLATFORM.md](PLATFORM.md) |
| Which env vars the backend reads | [ENVIRONMENT.md](ENVIRONMENT.md) |

A Postman collection is in [`../postman/`](../postman/) — import both the
collection and the environment, run **Auth → login**, and the token is captured
for every later request automatically.

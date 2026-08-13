# Database Model Structures

MongoDB via Mongoose. 20 collections. Every schema uses `{ timestamps: true }` unless noted, so
`createdAt` / `updatedAt` exist everywhere.

Conventions used below:
- `ObjectId → Model` means a `mongoose.Schema.Types.ObjectId` with `ref: 'Model'`.
- **`select: false`** fields are excluded from queries unless explicitly `.select('+field')`ed.
  This is the mechanism that keeps secrets out of API responses.
- Subdocument arrays marked `_id: false` do not get per-element `_id`s.

**Jump to:** [User](#user) · [Workspace](#workspace) · [Chat](#chat) · [Message](#message) ·
[Call](#call) · [Meeting](#meeting) · [Status](#status) · [Session](#session) ·
[Community](#community) · [Notification](#notification) · [ContactRequest](#contactrequest) ·
[EmailVerification](#emailverification) · [ApiKey](#apikey) · [IncomingWebhook](#incomingwebhook) ·
[BroadcastList](#broadcastlist) · [Product](#product) · [Label](#label) · [QuickReply](#quickreply) ·
[PushSubscription](#pushsubscription) · [Report](#report) · [Relationships](#relationships)

---

## User

Collection: `users`. A platform account — identity, credentials, workspace membership,
privacy/notification settings, contacts and per-chat state.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `name` | String | — | `required`, `trim`, `maxlength: 60` |
| `username` | String | — | `required`, `unique`, `lowercase`, `trim`, 3–30 chars, `match: /^[a-z0-9_.]+$/` |
| `email` | String | — | `required`, `unique`, `lowercase`, `trim`, `match: /^\S+@\S+\.\S+$/` |
| `password` | String | — | `required`, `minlength: 8`, **`select: false`** |
| `avatar` | String | `''` | |
| `bio` | String | `'Available on ChatKonect'` | `maxlength: 160` |
| `phone` | String | `''` | `trim`; unique via the partial index below — empty allowed |
| `role` | String | `'user'`; enum `user \| admin` | Platform level; `admin` = super-admin |
| `accountStatus` | String | `'active'`; enum `active \| suspended \| banned` | |
| `workspace` | ObjectId → Workspace | — | indexed |
| `workspaceRole` | String | `'member'`; enum `owner \| admin \| member` | |
| `isVerified` | Boolean | `false` | |
| `otp` | String | — | **`select: false`** |
| `otpExpires` | Date | — | **`select: false`** |
| `otpAttempts` | Number | `0` | **`select: false`** |
| `resetPasswordToken` | String | — | **`select: false`** |
| `resetPasswordExpires` | Date | — | **`select: false`** |
| `tokenVersion` | Number | `0` | Bumped on password change/reset to invalidate all issued JWTs |
| `twoStepEnabled` | Boolean | `false` | |
| `twoStepPin` | String | — | **`select: false`**; bcrypt-hashed app-lock PIN |
| `twoStepResetOtp` | String | — | **`select: false`** |
| `twoStepResetExpires` | Date | — | **`select: false`** |
| `twoStepResetAttempts` | Number | `0` | **`select: false`** |
| `isOnline` | Boolean | `false` | |
| `lastSeen` | Date | `Date.now` | |
| `presenceState` | String | `'available'`; enum `available \| away \| busy \| dnd` | `dnd` suppresses push + desktop notifications |
| `contacts[]` | ObjectId → User | `[]` | |
| `favorites[]` | ObjectId → User | `[]` | |
| `blockedUsers[]` | ObjectId → User | `[]` | |
| `pinnedChats[]` | ObjectId → Chat | `[]` | |
| `archivedChats[]` | ObjectId → Chat | `[]` | |
| `mutedChats[]` | ObjectId → Chat | `[]` | Suppresses push for that chat |
| `lockedChats[]` | ObjectId → Chat | `[]` | Hidden behind the two-step PIN |
| `privacy` | Object | see below | **Untyped `Object`** — defaults only, no enum enforcement |
| `privacy.lastSeen` | — | `'everyone'` | `everyone \| contacts \| nobody` |
| `privacy.profilePhoto` | — | `'everyone'` | |
| `privacy.about` | — | `'everyone'` | |
| `privacy.status` | — | `'contacts'` | |
| `privacy.readReceipts` | — | `true` | |
| `privacy.groupAddPermission` | — | `'everyone'` | `everyone \| contacts` |
| `privacy.onlineStatus` | — | `'everyone'` | |
| `settings.theme` | String | `'dark'`; enum `light \| dark \| system` | |
| `settings.accent` | String | `'indigo'`; enum `indigo \| violet \| cyan \| emerald \| rose \| amber` | |
| `settings.notifications.messages` | Boolean | `true` | |
| `settings.notifications.groups` | Boolean | `true` | |
| `settings.notifications.calls` | Boolean | `true` | |
| `settings.notifications.meetings` | Boolean | `true` | |
| `settings.notifications.sound` | Boolean | `true` | Note: **`sound`**, singular |
| `settings.enterToSend` | Boolean | `true` | |

**Indexes**
- `{ username: 1 }` unique, `{ email: 1 }` unique, `{ workspace: 1 }`
- Text index `{ name: 'text', username: 'text', email: 'text' }` — powers user search
- Partial unique `{ phone: 1 }` with `partialFilterExpression: { phone: { $type: 'string', $gt: '' } }`
  — one phone = one account, but accounts with no phone never collide

**Hooks & methods**
- `pre('save')` — bcrypt-hashes `password` (cost 12) only when modified.
- `matchPassword(entered)` — bcrypt compare. Returns `false` rather than throwing when the account
  has no local password (OAuth) or the input is empty, so login's try-each-candidate loop is never
  aborted mid-way.
- `toSafeJSON()` — strips `password`, `otp`, `otpExpires`, `resetPasswordToken`,
  `resetPasswordExpires`, `twoStepPin`, `twoStepResetOtp`, `twoStepResetExpires`,
  `twoStepResetAttempts`. **Does not** strip `otpAttempts` or `tokenVersion`.

---

## Workspace

Collection: `workspaces`. A tenant/organisation: roles, invites, member admin, plus the
WhatsApp-Business storefront profile and auto-replies.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `name` | String | — | `required`, `trim`, `maxlength: 80` |
| `slug` | String | — | `required`, `unique`, `lowercase`, `trim` |
| `type` | String | `'team'`; enum `team \| personal` | indexed; `personal` = the single shared consumer space |
| `owner` | ObjectId → User | — | indexed |
| `inviteCode` | String | — | `required`, `unique`, indexed; rotatable by owner/admin |
| `plan` | String | `'free'`; enum `free \| pro \| business` | |
| `businessProfile` | subdoc `_id: false` | `{}` | |
| `businessProfile.category` | String | `''` | |
| `businessProfile.description` | String | `''` | `maxlength: 1000` |
| `businessProfile.hours` | String | `''` | Free text, e.g. `"Mon–Fri 9–5"` |
| `businessProfile.address` | String | `''` | |
| `businessProfile.website` | String | `''` | |
| `businessProfile.email` | String | `''` | |
| `businessProfile.verified` | Boolean | `false` | Platform-admin-granted badge |
| `autoReplies` | subdoc `_id: false` | `{}` | |
| `autoReplies.greeting.enabled` | Boolean | `false` | Fires once per chat on a customer's first message |
| `autoReplies.greeting.text` | String | `''` | `maxlength: 1000` |
| `autoReplies.away.enabled` | Boolean | `false` | Fires (throttled) outside business hours |
| `autoReplies.away.text` | String | `''` | `maxlength: 1000` |
| `autoReplies.away.startHour` | Number | `9`, 0–23 | 24h local time |
| `autoReplies.away.endHour` | Number | `18`, 0–23 | Window is `[startHour, endHour)` |
| `settings` | Object | `{}` | Untyped, free-form |

**Indexes:** `{ slug: 1 }` unique, `{ type: 1 }`, `{ owner: 1 }`, `{ inviteCode: 1 }` unique.

**Module exports (not schema methods):** `generateInviteCode()` → `crypto.randomBytes(9).toString('base64url')`
(12 chars, ~72 bits); `slugifyName(name)` → lowercase, non-alphanumerics → `-`, trimmed, max 40 chars,
falling back to `'workspace'`. Uniqueness is enforced by the caller, not the schema.

> Membership lives on the **User** side (`User.workspace` + `User.workspaceRole`), not as an array here.

---

## Chat

Collection: `chats`. The unified conversation container for **both** 1:1 and group chats —
`isGroup` distinguishes them. There is no separate Group model.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `workspace` | ObjectId → Workspace | — | indexed |
| `isGroup` | Boolean | `false` | |
| `participants[]` | subdoc `_id: false` | `[]` | |
| `participants[].user` | ObjectId → User | — | `required` |
| `participants[].role` | String | `'member'`; enum `member \| admin \| owner` | |
| `participants[].joinedAt` | Date | `Date.now` | |
| `name` | String | — | Group only; `trim`, `maxlength: 80` |
| `description` | String | `''` | `maxlength: 500` |
| `avatar` | String | `''` | |
| `createdBy` | ObjectId → User | — | |
| `inviteCode` | String | — | `unique`, `sparse` |
| `messagingPolicy` | String | `'all'`; enum `all \| admins` | `admins` = announcement-style group |
| `lastMessage` | ObjectId → Message | — | **A ref, not an embedded snapshot** |
| `pinnedMessages[]` | ObjectId → Message | `[]` | |
| `disappearingSeconds` | Number | `0`, `min: 0` | 0 = off; new messages self-delete after N seconds |
| `labels[]` | ObjectId → Label | `[]` | Workspace-scoped labels applied to this chat |

**Indexes:** `{ workspace: 1 }`, `{ inviteCode: 1 }` unique+sparse,
`{ 'participants.user': 1, updatedAt: -1 }` — the compound index that serves the chat-list query.

**Hooks:** `pre('save')` generates a 10-char `inviteCode` for groups from the unambiguous alphabet
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` using `crypto.randomInt` (CSPRNG, not `Math.random`).

---

## Message

Collection: `messages`. A single message of any kind — text, media, location/live-location, poll,
shared product, or system event — plus reactions, receipts and ephemeral/deletion state.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `chat` | ObjectId → Chat | — | `required`, indexed |
| `sender` | ObjectId → User | — | |
| `type` | String | `'text'`; enum `text \| image \| video \| audio \| voice \| document \| location \| poll \| product \| system` | |
| `content` | String | `''` | |
| `attachments[]` | subdoc `_id: false` | `[]` | |
| `attachments[].url` | String | — | |
| `attachments[].name` | String | — | |
| `attachments[].size` | Number | — | Bytes |
| `attachments[].mime` | String | — | |
| `attachments[].width` | Number | — | |
| `attachments[].height` | Number | — | |
| `attachments[].duration` | Number | — | Seconds, for audio/video/voice |
| `location.lat` | Number | — | Inline object, not a subschema |
| `location.lng` | Number | — | |
| `location.label` | String | — | |
| `liveLocation.active` | Boolean | `false` | Flips false when the sharer stops |
| `liveLocation.expiresAt` | Date | — | |
| `poll.question` | String | — | `required` within `poll` |
| `poll.options[].text` | String | — | `required` |
| `poll.options[].votes[]` | ObjectId → User | `[]` | |
| `poll.multi` | Boolean | `false` | Allow selecting more than one option |
| `poll.closed` | Boolean | `false` | |
| `product.ref` | ObjectId → Product | — | Points to the live Product when it still exists |
| `product.name` / `.description` / `.price` / `.currency` / `.image` / `.link` | — | — | Embedded **snapshot**, so the card still renders after the Product is edited or deleted |
| `autoReplyKind` | String | — | `'greeting'` or `'away'` when sent by a business auto-reply (no enum declared) |
| `expiresAt` | Date | — | Disappearing messages; TTL index removes the doc |
| `viewOnce` | Boolean | `false` | Media self-destructs once every recipient has opened it |
| `viewedBy[]` | ObjectId → User | `[]` | |
| `replyTo` | ObjectId → Message | — | Self-reference |
| `forwardedFrom` | ObjectId → User | — | |
| `mentions[]` | ObjectId → User | `[]` | |
| `reactions[]` | subdoc `_id: false` | `[]` | `{ user, emoji }` |
| `readBy[]` | subdoc | `[]` | `{ user, at }` — `_id` **not** disabled here |
| `deliveredTo[]` | ObjectId → User | `[]` | |
| `starredBy[]` | ObjectId → User | `[]` | |
| `editedAt` | Date | — | |
| `isEdited` | Boolean | `false` | |
| `isDeleted` | Boolean | `false` | Deleted for everyone |
| `deletedFor[]` | ObjectId → User | `[]` | Deleted for me |
| `systemEvent` | String | — | e.g. `member_added`, `group_created` (no enum declared) |

**Indexes**
- `{ chat: 1 }`, `{ chat: 1, createdAt: -1 }` — message pagination
- Text index `{ content: 'text' }` — message search
- `{ 'attachments.url': 1 }` — the media access-control lookup on every `/uploads` request
- TTL `{ expiresAt: 1 }`, `expireAfterSeconds: 0` — disappearing messages expire at the stored time
- `{ starredBy: 1 }` — starred-messages view

---

## Call

Collection: `calls`. A call record (1:1 or group, audio or video) with per-participant state and timing.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `type` | String | `'audio'`; enum `audio \| video` | |
| `isGroup` | Boolean | `false` | |
| `chat` | ObjectId → Chat | — | |
| `initiator` | ObjectId → User | — | `required`; historical name for the caller |
| `caller` | ObjectId → User | — | Explicit 1:1 field |
| `receiver` | ObjectId → User | — | Explicit 1:1 field |
| `participants[]` | subdoc `_id: false` | `[]` | |
| `participants[].user` | ObjectId → User | — | |
| `participants[].status` | String | `'ringing'`; enum `ringing \| joined \| left \| rejected \| missed` | |
| `participants[].joinedAt` / `.leftAt` | Date | — | |
| `status` | String | `'ringing'`; enum `ringing \| accepted \| ongoing \| completed \| missed \| rejected` | `accepted` = live now; `ongoing` kept for legacy rows |
| `startedAt` | Date | `Date.now` | |
| `answeredAt` / `endedAt` | Date | — | |
| `duration` | Number | `0` | Seconds |

**Indexes:** `{ initiator: 1, createdAt: -1 }`, `{ caller: 1, createdAt: -1 }`, `{ receiver: 1, createdAt: -1 }`.

**Virtual:** `callType` — alias for `type`, serialized because `toJSON`/`toObject` set `virtuals: true`.

> Quirk: `initiator` (required, legacy) and `caller` (optional) both denote the caller, so the same
> user id is normally stored twice.

---

## Meeting

Collection: `meetings`. A scheduled or instant meeting with RSVPs, a Google-Meet-style shareable
room code, host policy settings, and a live attendance record.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `title` | String | — | `required`, `trim`, `maxlength: 120` |
| `description` | String | `''` | `maxlength: 1000` |
| `host` | ObjectId → User | — | `required`, indexed |
| `participants[]` | subdoc `_id: false` | `[]` | The RSVP/invite list |
| `participants[].user` | ObjectId → User | — | indexed |
| `participants[].response` | String | `'pending'`; enum `going \| maybe \| not_going \| pending` | |
| `participants[].viaLink` | Boolean | `false` | Joined via shareable link; these rows do **not** count as "invited" for the ask-to-join gate |
| `chat` | ObjectId → Chat | — | |
| `startAt` | Date | — | `required` |
| `durationMinutes` | Number | `30` | |
| `timezone` | String | `'UTC'` | |
| `type` | String | `'video'`; enum `audio \| video` | |
| `roomCode` | String | — | `unique`, indexed; e.g. `abc-defg-hij` |
| `link` | String | — | |
| `settings.joinAnytime` | Boolean | `true` | If false, guests can only join once the host is present |
| `settings.muteOnEntry` | Boolean | `false` | |
| `settings.autoRecord` | Boolean | `false` | Guests' clients auto-start a local recording |
| `settings.askToJoin` | Boolean | `true` | Uninvited people must knock and be admitted |
| `recurrence` | String | `'none'`; enum `none \| daily \| weekly \| monthly` | |
| `reminderMinutes` | Number | `10` | |
| `status` | String | `'scheduled'`; enum `scheduled \| ongoing \| completed \| cancelled` | |
| `startedAt` | Date | `null` | First join |
| `endedAt` | Date | — | Last leave |
| `attendees[]` | subdoc `_id: false` | `[]` | One row per person who actually joined |
| `attendees[].user` | ObjectId → User | — | |
| `attendees[].name` / `.email` | String | — | Snapshotted at join time |
| `attendees[].joinedAt` / `.leftAt` | Date | — | |
| `attendees[].durationSeconds` | Number | `0` | Accumulates across rejoins |

**Indexes:** `{ host: 1 }`, `{ 'participants.user': 1 }`, `{ roomCode: 1 }` unique, `{ startAt: 1 }`.

**Module export:** `generateRoomCode()` builds a readable `abc-defg-hij` code via `crypto.randomInt`
over `abcdefghijkmnpqrstuvwxyz23456789` (ambiguous chars removed). `roomCode` is **not** auto-populated
by a hook — callers must set it.

> Two parallel people-lists: `participants` (invited / RSVP) vs `attendees` (actually showed up).

---

## Status

Collection: `statuses`. A story post that auto-expires 24h after creation.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `user` | ObjectId → User | — | `required` |
| `type` | String | `'text'`; enum `text \| image \| video` | |
| `content` | String | `''` | |
| `media` | String | `''` | |
| `background` | String | `linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)` | |
| `viewers[]` | subdoc | `[]` | `{ user, at }` |
| `replies[]` | subdoc | `[]` | `{ user, text, at }` |
| `privacy.type` | String | `'contacts'`; enum `everyone \| contacts \| selected \| except` | Nested key literally named `type` |
| `privacy.allow[]` | ObjectId → User | `[]` | Allow-list for `selected` |
| `privacy.except[]` | ObjectId → User | `[]` | Deny-list for `except` |
| `expiresAt` | Date | `now + 24h` (function default) | |

**Indexes:** TTL `{ expiresAt: 1 }` `expireAfterSeconds: 0`; `{ user: 1, createdAt: -1 }` (serves the
feed query without an in-memory sort).

---

## Session

Collection: `sessions`. One row per device/login. Its id (`sid`) rides inside the access JWT, so
revocation takes effect immediately rather than at token expiry.

| Field | Type | Default | Notes |
|---|---|---|---|
| `user` | ObjectId → User | — | `required`, indexed |
| `refreshHash` | String | — | `required`, indexed, **`select: false`**; SHA-256 of the current refresh token, rotated on every refresh |
| `device` | String | `'Unknown device'` | |
| `userAgent` | String | `''` | |
| `ip` | String | `''` | |
| `lastActiveAt` | Date | `Date.now` | |
| `revokedAt` | Date | `null` | |
| `expiresAt` | Date | — | `required`; absolute expiry |

**Indexes:** `{ user: 1 }`, `{ refreshHash: 1 }` (**not** unique), TTL `{ expiresAt: 1 }` `expireAfterSeconds: 0`.

---

## Community

Collection: `communities`. Groups several group-chats under one umbrella with an admins-only
announcement group plus linked topic groups.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `name` | String | — | `required`, `trim`, `maxlength: 80` |
| `description` | String | `''` | `maxlength: 500` |
| `avatar` | String | `''` | |
| `workspace` | ObjectId → Workspace | `null` | indexed; null = personal community |
| `createdBy` | ObjectId → User | — | |
| `members[].user` | ObjectId → User | — | `required` |
| `members[].role` | String | `'member'`; enum `admin \| member` | |
| `groups[]` | ObjectId → Chat | `[]` | Linked topic groups |
| `announcementGroup` | ObjectId → Chat | — | |
| `inviteCode` | String | — | `unique`, indexed |

**Indexes:** `{ workspace: 1 }`, `{ inviteCode: 1 }` unique, `{ 'members.user': 1, updatedAt: -1 }`.

**Hooks:** `pre('save')` sets `inviteCode` to `crypto.randomBytes(9).toString('base64url')` when missing.

---

## Notification

Collection: `notifications`. In-app bell records.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `user` | ObjectId → User | — | `required`, indexed; recipient |
| `from` | ObjectId → User | — | Actor |
| `type` | String | `'message'`; enum `message \| group_message \| mention \| incoming_call \| missed_call \| meeting_reminder \| status_reply \| contact_request \| system` | |
| `title` | String | — | |
| `body` | String | — | |
| `data` | Object | `{}` | Free-form payload |
| `isRead` | Boolean | `false` | |

**Indexes:** `{ user: 1 }`, `{ user: 1, isRead: 1, createdAt: -1 }`.

---

## ContactRequest

Collection: `contactrequests`.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `from` | ObjectId → User | — | `required` |
| `to` | ObjectId → User | — | `required` |
| `status` | String | `'pending'`; enum `pending \| accepted \| rejected` | |
| `message` | String | `''` | |

**Indexes:** `{ from: 1, to: 1 }` unique; `{ to: 1, status: 1 }`; `{ from: 1, status: 1 }`.
The latter two exist because the unique compound index can't serve a `status` filter as a usable prefix.

---

## EmailVerification

Collection: `emailverifications`. Pre-signup email OTP — exists **before** any User does, one live
record per address (upserted on each send).

| Field | Type | Default | Notes |
|---|---|---|---|
| `email` | String | — | `required`, `unique`, `lowercase`, `trim` |
| `otp` | String | — | **`select: false`** |
| `expires` | Date | — | |
| `attempts` | Number | `0` | 5 wrong guesses locks the code |
| `verifiedAt` | Date | `null` | |

**Indexes:** `{ email: 1 }` unique; TTL `{ updatedAt: 1 }` `expireAfterSeconds: 3600` — rows self-delete
one hour after their last update.

---

## ApiKey

Collection: `apikeys`. A developer key for third-party integrations, acting on behalf of its owner and
limited to granted scopes. Only the SHA-256 hash is stored.

| Field | Type | Default | Notes |
|---|---|---|---|
| `owner` | ObjectId → User | — | `required`, indexed |
| `label` | String | `'API key'` | `trim`, `maxlength: 80` |
| `hashedKey` | String | — | `required`, `unique`, indexed, **`select: false`** |
| `prefix` | String | — | `required`; safe-to-display prefix, e.g. `cc_live_ab12` |
| `scopes[]` | String | `[]` | Validated against `API_SCOPES` (below) |
| `active` | Boolean | `true` | |
| `lastUsedAt` | Date | — | |

`API_SCOPES` = `chat:read`, `chat:write`, `contacts:read`, `calls:write`, `meetings:read`, `meetings:write`.
An unknown scope fails validation with `'Contains an unknown scope.'`

---

## IncomingWebhook

Collection: `incomingwebhooks`. A secret URL token letting an external service post a message into a
specific group chat with no user session.

| Field | Type | Default | Notes |
|---|---|---|---|
| `token` | String | — | `required`, `unique`, indexed; **the only credential — treat as a password** |
| `chat` | ObjectId → Chat | — | `required`, indexed |
| `workspace` | ObjectId → Workspace | — | indexed |
| `createdBy` | ObjectId → User | — | `required`; posted messages are attributed to this user |
| `label` | String | `'Webhook'` | `maxlength: 60` |
| `active` | Boolean | `true` | |
| `lastUsedAt` | Date | `null` | |

---

## BroadcastList

Collection: `broadcastlists`. Send one message to many contacts, delivered into each recipient's own
1:1 chat.

| Field | Type | Default | Notes |
|---|---|---|---|
| `owner` | ObjectId → User | — | `required`, indexed |
| `name` | String | — | `required`, `trim`, `maxlength: 80` |
| `recipients[]` | ObjectId → User | `[]` | |

---

## Product

Collection: `products`. A WhatsApp-Business catalog item owned by a workspace, shareable into a chat.

| Field | Type | Default | Notes |
|---|---|---|---|
| `workspace` | ObjectId → Workspace | — | `required`, indexed |
| `createdBy` | ObjectId → User | — | |
| `name` | String | — | `required`, `trim`, `maxlength: 120` |
| `description` | String | `''` | `maxlength: 2000` |
| `price` | Number | `0`, `min: 0` | |
| `currency` | String | `'USD'` | `maxlength: 8` |
| `images[]` | String | `[]` | |
| `link` | String | `''` | `maxlength: 500` |
| `inStock` | Boolean | `true` | |

**Indexes:** `{ workspace: 1 }`, `{ workspace: 1, createdAt: -1 }`.

---

## Label

Collection: `labels`. A workspace tag agents apply to chats, e.g. "New customer", "Pending payment".

| Field | Type | Default | Notes |
|---|---|---|---|
| `workspace` | ObjectId → Workspace | — | `required`, indexed |
| `name` | String | — | `required`, `trim`, `maxlength: 40` |
| `color` | String | `'#6366f1'` | `maxlength: 20` |
| `createdBy` | ObjectId → User | — | |

**Indexes:** `{ workspace: 1 }`, `{ workspace: 1, name: 1 }` unique.

---

## QuickReply

Collection: `quickreplies`. A canned response shared across a workspace's agents, expanded from a
`/shortcut` in the composer.

| Field | Type | Default | Notes |
|---|---|---|---|
| `workspace` | ObjectId → Workspace | — | `required`, indexed |
| `shortcut` | String | — | `required`, `trim`, `maxlength: 40` |
| `text` | String | — | `required`, `maxlength: 2000` |
| `createdBy` | ObjectId → User | — | |

**Indexes:** `{ workspace: 1 }`, `{ workspace: 1, shortcut: 1 }` unique.

---

## PushSubscription

Collection: `pushsubscriptions`. One browser Web-Push subscription per device.

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId → User | `required`, indexed |
| `endpoint` | String | `required`, `unique` |
| `keys.p256dh` | String | `required` |
| `keys.auth` | String | `required` |
| `userAgent` | String | |

---

## Report

Collection: `reports`. An abuse report against a user, group, message or status.

| Field | Type | Default / Enum | Notes |
|---|---|---|---|
| `reporter` | ObjectId → User | — | `required` |
| `targetType` | String | enum `user \| group \| message \| status` | `required`, no default |
| `targetUser` | ObjectId → User | — | |
| `targetChat` | ObjectId → Chat | — | `targetType: 'group'` maps here |
| `targetMessage` | ObjectId → Message | — | |
| `reason` | String | — | `required`, `maxlength: 120` |
| `description` | String | `''` | `maxlength: 2000` |
| `status` | String | `'open'`; enum `open \| reviewing \| resolved \| dismissed` | |

**Indexes:** none declared beyond `_id`. Which target field is populated is not schema-enforced.

---

## Relationships

```
User.workspace ────────────────► Workspace
User.contacts[] / favorites[] / blockedUsers[] ──► User   (self-referencing)
User.pinnedChats[] / archivedChats[] / mutedChats[] / lockedChats[] ──► Chat

Workspace.owner ───────────────► User
   (membership is on the User side: User.workspace + User.workspaceRole)

Chat.workspace ────────────────► Workspace
Chat.participants[].user ──────► User
Chat.createdBy ────────────────► User
Chat.lastMessage ──────────────► Message      ← a ref, NOT an embedded snapshot
Chat.pinnedMessages[] ─────────► Message
Chat.labels[] ─────────────────► Label        ← Label↔Chat many-to-many, stored on Chat

Message.chat ──────────────────► Chat
Message.sender / forwardedFrom ► User
Message.replyTo ───────────────► Message      ← self-reference
Message.mentions[] / viewedBy[] / deliveredTo[] / starredBy[] / deletedFor[] ──► User
Message.reactions[].user, readBy[].user, poll.options[].votes[] ──► User
Message.product.ref ───────────► Product      (+ embedded snapshot of the fields)

Call.chat ─────────────────────► Chat
Call.initiator / caller / receiver / participants[].user ──► User

Meeting.host ──────────────────► User
Meeting.chat ──────────────────► Chat
Meeting.participants[].user ───► User   (invited / RSVP)
Meeting.attendees[].user ──────► User   (actually attended)

Community.workspace ───────────► Workspace (nullable = personal)
Community.members[].user ──────► User
Community.groups[] / announcementGroup ──► Chat

Status.user, viewers[].user, replies[].user, privacy.allow[], privacy.except[] ──► User
ContactRequest.from / to ──────► User
Notification.user (recipient) / from (actor) ──► User
Report.reporter / targetUser ──► User;  targetChat ──► Chat;  targetMessage ──► Message
Session.user, ApiKey.owner, PushSubscription.user, BroadcastList.owner ──► User
BroadcastList.recipients[] ────► User
Label.workspace, Product.workspace, QuickReply.workspace ──► Workspace
IncomingWebhook.chat ──► Chat;  .workspace ──► Workspace;  .createdBy ──► User
EmailVerification ─── no refs (keyed by email, exists before the User)
```

### Things worth knowing

- **No Group model.** `Chat.isGroup` + `Chat.participants[].role` covers groups entirely.
- **`Chat.lastMessage` is a ref**, so listing chats requires a populate — it is not a denormalised copy.
- **`User.privacy` is a raw untyped `Object`** (defaults only, no enum validation), unlike
  `User.settings`, which is a fully typed nested path.
- **`Meeting.roomCode` and `Workspace.inviteCode`/`slug` have no `pre('save')` generator** (unlike
  `Chat.inviteCode` and `Community.inviteCode`, which do). Callers must set them via the exported helpers.
- **TTL collections:** `Status` (24h), `Message` (per-message `expiresAt`), `Session` (absolute expiry),
  `EmailVerification` (1h after last update). Mongo's TTL monitor runs about every 60s, so deletion is
  eventually-consistent, not instant.

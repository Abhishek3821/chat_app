# Backend API Documentation

Complete REST reference for the ChatConnect API. Every endpoint below was verified against the
route definitions in `server/routes/` — **158 endpoints across 24 routers**.

- **Base URL (dev):** `http://localhost:5000/api`
- **Base URL (prod):** `https://<your-host>/api`
- See [ENVIRONMENT.md](ENVIRONMENT.md) for how the client resolves these.
- Auth details: [AUTHENTICATION.md](AUTHENTICATION.md) · Realtime: [SOCKET_EVENTS.md](SOCKET_EVENTS.md)
- Ready-to-run requests: [`postman/ChatConnect.postman_collection.json`](../postman/ChatConnect.postman_collection.json)

## Router map

| Prefix | Router | Auth model |
|---|---|---|
| `/api/auth` | `authRoutes.js` | public + `protect` |
| `/api/users` | `userRoutes.js` | `protect` |
| `/api/contacts` | `contactRoutes.js` | `protect` |
| `/api/chats` | `chatRoutes.js` | `protect` |
| `/api/messages` | `messageRoutes.js` | `protect` |
| `/api/groups` | `groupRoutes.js` | `protect` |
| `/api/calls` | `callRoutes.js` | `protect` |
| `/api/meetings` | `meetingRoutes.js` | `protect` |
| `/api/status` | `statusRoutes.js` | `protect` |
| `/api/notifications` | `notificationRoutes.js` | `protect` |
| `/api/push` | `pushRoutes.js` | `protect` |
| `/api/upload` | `uploadRoutes.js` | `protect` |
| `/api/live-location` | `liveLocationRoutes.js` | `protect` |
| `/api/communities` | `communityRoutes.js` | `protect` |
| `/api/catalog` | `catalogRoutes.js` | `protect` |
| `/api/agent` | `agentRoutes.js` | `protect` |
| `/api/broadcasts` | `broadcastRoutes.js` | `protect` |
| `/api/workspaces` | `workspaceRoutes.js` | `protect` + RBAC |
| `/api/reports` | `reportRoutes.js` | `protect` |
| `/api/keys` | `keyRoutes.js` | `protect` |
| `/api/admin` | `adminRoutes.js` | `protect` + `adminOnly` |
| `/api/webhooks` | `webhookRoutes.js` | `protect` |
| `/api/hooks` | `hookIngressRoutes` | **public** — URL token is the credential |
| `/api/v1` | `v1Routes.js` | **`X-API-Key`** (third-party) |

There is also `GET /api/health` (public) returning
`{ "success": true, "service": "ChatConnect API", "db": "connected", "email": "configured", "time": "…" }`.

---

## Global conventions

All routers below are mounted under `/api` (`server.js`: `app.use('/api', apiLimiter, csrfGuard, apiRoutes)`), then under the prefix from `server/routes/index.js`:

| Router file | Mount prefix |
|---|---|
| `authRoutes.js` | `/api/auth` |
| `userRoutes.js` | `/api/users` |
| `contactRoutes.js` | `/api/contacts` |
| `chatRoutes.js` | `/api/chats` |
| `messageRoutes.js` | `/api/messages` |
| `groupRoutes.js` | `/api/groups` |

Applies to **every** endpoint below and is not repeated per-row:

- **`apiLimiter`** (`middleware/rateLimit.js`): 1000 requests / 15 min per IP (Redis-backed when `REDIS_URL` set). Exceeded → `429 {"success":false,"message":"Too many requests, please slow down."}`
- **`csrfGuard`** (`middleware/csrf.js`): all non-`GET/HEAD/OPTIONS` requests must have no `Origin`/`Referer` header or an allowlisted one → else `403 "Cross-site request blocked."`
- **`mongoSanitize`**, `express.json({ limit: '2mb' })`, `cookieParser`.
- **`protect`** (`middleware/auth.js`): access JWT from `Authorization: Bearer <token>` or the `token` cookie. Rejects scoped tokens, requires a `sid` claim mapping to a live `Session`, and requires `decoded.tokenVersion === user.tokenVersion`. Errors it can throw on *any* protected route:
  - `401 "Not authenticated. Please log in."` (no token, or a scoped token)
  - `401 "Session expired or invalid. Please log in again."` (bad/expired JWT, or no `sid`)
  - `401 "User no longer exists."`
  - `403 "This account has been banned."` / `403 "This account is suspended."`
  - `401 "Session has been revoked. Please log in again."` (tokenVersion mismatch)
  - `401 "Session expired or revoked. Please log in again."` (session revoked/expired/idle-expired, or belongs to another user)
  - Side effect: bumps `Session.lastActiveAt` if stale > 5 min; sets `req.user`, `req.sessionId`.
- **Error envelope** (`middleware/error.js`): `{"success": false, "message": "..."}`. `CastError` → `400 "Invalid <path>: <value>"`; duplicate key → `409 "That <field> is already taken."`; Mongoose `ValidationError` → `400` with joined messages.
- `adminOnly` (platform admin) and `apiKeyAuth(scopes)` are applied only where noted per-endpoint.

### Shared response objects

**`SafeUser`** = `user.toSafeJSON()` (`models/User.js`) — the full user document minus `password`, `otp`, `otpExpires`, `resetPasswordToken`, `resetPasswordExpires`, `twoStepPin`, `twoStepResetOtp`, `twoStepResetExpires`, `twoStepResetAttempts`. So it includes:

```json
{
  "_id": "66a1f0c2e4b1a2c3d4e5f601",
  "name": "Ada Lovelace", "username": "ada", "email": "ada@example.com",
  "phone": "+919876543210", "avatar": "https://api.dicebear.com/9.x/glass/svg?seed=ada",
  "bio": "Available on ChatConnect",
  "role": "user", "accountStatus": "active",
  "workspace": "66a1f0c2e4b1a2c3d4e5f5aa", "workspaceRole": "member",
  "isVerified": true, "tokenVersion": 0, "twoStepEnabled": false,
  "isOnline": true, "lastSeen": "2026-07-29T10:00:00.000Z", "presenceState": "available",
  "contacts": ["66a1..."], "favorites": [], "blockedUsers": [],
  "pinnedChats": [], "archivedChats": [], "mutedChats": [], "lockedChats": [],
  "privacy": { "lastSeen": "everyone", "profilePhoto": "everyone", "about": "everyone",
               "status": "contacts", "readReceipts": true,
               "groupAddPermission": "everyone", "onlineStatus": "everyone" },
  "settings": { "theme": "dark", "accent": "indigo",
                "notifications": { "messages": true, "groups": true, "calls": true, "meetings": true, "sound": true },
                "enterToSend": true },
  "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-07-29T10:00:00.000Z", "__v": 0
}
```

**`PublicUser`** = `select('name username email phone avatar bio isOnline lastSeen accountStatus createdAt privacy contacts')` then `applyPresencePrivacy(obj, viewerIsContact)` (`utils/privacy.js`), which **deletes `privacy` and `contacts`**, forces `isOnline:false` if `privacy.onlineStatus` disallows the viewer, sets `lastSeen:null` if `privacy.lastSeen` disallows, and **deletes `phone` and `email` when the viewer is not a contact**:

```json
{ "_id": "66a1...", "name": "Ada Lovelace", "username": "ada",
  "email": "ada@example.com", "phone": "+919876543210",
  "avatar": "https://...", "bio": "Available on ChatConnect",
  "isOnline": true, "lastSeen": "2026-07-29T10:00:00.000Z",
  "accountStatus": "active", "createdAt": "2026-01-01T00:00:00.000Z" }
```

**`ChatPopulated`** = `Chat` document with `participants.user` populated as `name username avatar bio isOnline lastSeen` (chat controller) or `name username email avatar bio isOnline lastSeen` (group controller), and `lastMessage` populated with its `sender` as `name username avatar`:

```json
{
  "_id": "66b2...", "workspace": "66a1...", "isGroup": true,
  "participants": [{ "user": { "_id": "66a1...", "name": "Ada", "username": "ada", "avatar": "https://...", "bio": "…", "isOnline": true, "lastSeen": "2026-07-29T10:00:00.000Z" }, "role": "owner", "joinedAt": "2026-07-01T00:00:00.000Z" }],
  "name": "Team Rocket", "description": "", "avatar": "https://api.dicebear.com/9.x/shapes/svg?seed=Team%20Rocket",
  "createdBy": "66a1...", "inviteCode": "K7PQ2M9XZT", "messagingPolicy": "all",
  "lastMessage": { "_id": "66c3...", "chat": "66b2...", "sender": { "_id": "66a1...", "name": "Ada", "username": "ada", "avatar": "https://..." }, "type": "text", "content": "hey", "createdAt": "…" },
  "pinnedMessages": [], "disappearingSeconds": 0, "labels": [],
  "createdAt": "…", "updatedAt": "…", "__v": 0
}
```

**`MessagePopulated`** = `Message` document with `sender` and `reactions.user` populated as `name username avatar`, and `replyTo` populated (with its own `sender`):

```json
{
  "_id": "66c3...", "chat": "66b2...",
  "sender": { "_id": "66a1...", "name": "Ada", "username": "ada", "avatar": "https://..." },
  "type": "text", "content": "hey", "attachments": [],
  "location": null, "liveLocation": { "active": false },
  "poll": null, "product": null,
  "expiresAt": null, "viewOnce": false, "viewedBy": [],
  "replyTo": null, "forwardedFrom": null, "mentions": [],
  "reactions": [{ "user": { "_id": "66a1...", "name": "Ada", "username": "ada", "avatar": "https://..." }, "emoji": "👍" }],
  "readBy": [{ "user": "66a1...", "at": "2026-07-29T10:00:00.000Z" }],
  "deliveredTo": ["66a1..."], "starredBy": [],
  "isEdited": false, "isDeleted": false, "deletedFor": [],
  "createdAt": "…", "updatedAt": "…", "__v": 0
}
```

---


# Core resources

## Auth — `/api/auth`

### POST /api/auth/email/send-code
- **Auth**: none
- **Rate limit**: `authLimiter` (40 / 15 min per IP) + global `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `email` (string, required) — address to verify before any account exists
- **Success response**:
```json
{ "success": true, "message": "We sent a verification code to ada@example.com.", "devOtp": "123456" }
```
(`devOtp` present **only** when SMTP is unconfigured and `NODE_ENV !== 'production'`; `message` becomes `"Email is not configured — the code is shown below (development only)."` in that case)
- **Errors**:
  - `400` → `"Please provide a valid email address."`
  - `409` → `"An account with that email already exists."`
  - `502` → `"The email service rejected the server’s email login. Fix EMAIL_USER / EMAIL_PASS in the server’s environment settings."` (auth-class SMTP failure)
  - `502` → `"The email server is unreachable from this host right now. Please try again shortly."` (connection-class)
  - `502` → `"We could not send the verification email right now. Please try again in a moment."` (other)
  - `503` → `"Email sending is not configured on the server. Please contact support."` (production + no SMTP)
- **Notes**: upserts an `EmailVerification` doc (`otp`, 10-min `expires`, `attempts: 0`, `verifiedAt: null`); logs `securityEvent('signup.email.code')`. Send uses `sendEmailWithin` (only fast rejections are surfaced; slow relays finish in background).

### POST /api/auth/email/verify-code
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `email` (string, required); `otp` (string|number, required) — the 6-digit code
- **Success response**:
```json
{ "success": true, "verified": true, "emailToken": "eyJhbGciOiJIUzI1NiIs..." }
```
- **Errors**:
  - `400` → `"No code was requested for that email. Click Verify first."`
  - `429` → `"Too many incorrect attempts. Request a new code."` (≥5 attempts)
  - `400` → `"Invalid verification code."`
  - `400` → `"That code has expired. Request a new one."`
- **Notes**: `emailToken` is a JWT `{ email, purpose: 'signup-email' }` valid **30 minutes**, required by `/signup` when `ENABLE_EMAIL_VERIFICATION=true`. On success clears the stored OTP and stamps `verifiedAt`. Failed attempts increment `attempts`; `securityEvent` on locked/failure/verified.

### POST /api/auth/signup
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**:
  - `name` (string, required) — trimmed, truncated to 60 chars
  - `email` (string, required) — must match `/^\S+@\S+\.\S+$/`
  - `password` (string, required) — min 8 chars
  - `confirmPassword` (string, optional) — if a string, must equal `password`
  - `phone` (string, required) — normalized via `normalizePhone`, must be unique
  - `emailToken` (string, conditional) — required when `ENABLE_EMAIL_VERIFICATION === 'true'`
  - `inviteCode` (string, optional) — workspace invite; `invite` accepted as an alias
  - `accountType` (string, optional) — `'workspace'` creates a company workspace; anything else (including absent) → `'personal'`
  - `workspaceName` (string, optional) — used only when creating a new workspace
  - `username` (string, optional, legacy) — honored only if it matches `/^[a-z0-9_.]{3,30}$/`
  - `avatar` (string, optional) — base64 `data:image/(png|jpe?g|webp)` ≤ 400 000 chars, or an `https://` URL ≤ 2048 chars; anything else silently ignored
  - **Never read**: `role`, `isAdmin`, `accountStatus`, `isVerified`
- **Success response** (`201`, from `sendTokenResponse`):
```json
{ "success": true, "token": "eyJhbGciOiJIUzI1NiIs...", "user": { "...SafeUser": true } }
```
- **Errors**:
  - `400` → `"Name, email and password are required."`
  - `400` → `"Please provide a valid email address."`
  - `400` → `"Password must be at least 8 characters."`
  - `400` → `"Passwords do not match."`
  - `409` → `"An account with that email already exists."`
  - `400` → `"Please provide a valid phone number (7–15 digits, e.g. +919876543210)."`
  - `409` → `"That phone number is already linked to another account."`
  - `400` → `"Please verify your email address before signing up."`
  - `400` → `"That invite code is invalid or has expired."`
- **Notes**: username auto-derived from the email local part (retries up to 3× on the unique-index race); `role` forced to `'user'`, `isVerified: true`. Attaches the account via `joinWorkspaceByCode` / `joinPersonalSpace` / `createWorkspaceForUser`. Deletes the `EmailVerification` record. Sets httpOnly `token` (1 h) and `refreshToken` (path `/api/auth`, `REFRESH_TOKEN_DAYS` default 30 d) cookies and creates a `Session` row. `securityEvent('signup.success')`.

### POST /api/auth/verify-otp
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `email` (string, required); `otp` (string|number, required)
- **Success response** (`200`, `sendTokenResponse`):
```json
{ "success": true, "token": "eyJ...", "user": { "...SafeUser": true } }
```
- **Errors**:
  - `404` → `"No account found for that email."`
  - `400` → `"Account is already verified. Please log in."`
  - `429` → `"Too many incorrect attempts. Request a new code."` (`otpAttempts >= 5`)
  - `400` → `"Invalid verification code."`
  - `400` → `"Verification code has expired."`
- **Notes**: sets `isVerified: true`, clears `otp`/`otpExpires`/`otpAttempts`, creates a session (logs the user in). Deliberately never mints a session on the "already verified" branch.

### POST /api/auth/resend-otp
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `email` (string, required)
- **Success response**:
```json
{ "success": true, "message": "A new code has been sent.", "devOtp": "123456" }
```
(`devOtp` only when SMTP unconfigured and not production)
- **Errors**:
  - `404` → `"No account found for that email."`
  - `400` → `"Account is already verified."`
- **Notes**: writes a new `otp` with 10-min expiry on the User doc and resets `otpAttempts`.

### POST /api/auth/login
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `identifier` (string, required — falls back to `email` for legacy clients) — email, username, **or** phone; `password` (string, required)
- **Success response** (`200`, `sendTokenResponse`):
```json
{ "success": true, "token": "eyJ...", "user": { "...SafeUser": true } }
```
- **Errors**:
  - `400` → `"Enter your email, username or phone number, and your password."`
  - `401` → `"Invalid credentials. Check your details and try again."`
  - `403` → `"Please verify your email before logging in."` (only when `ENABLE_EMAIL_VERIFICATION=true`)
  - `403` → `"Your account is suspended."` / `"Your account is banned."` (template: `Your account is ${accountStatus}.`)
- **Notes**: a phone identifier may match several stored formats — up to 5 candidates are fetched and bcrypt-compared, so the password disambiguates. Sets `isOnline: true`, `lastSeen`; creates a `Session` + sets both auth cookies. `securityEvent('login.success' | 'login.failure')`.

### POST /api/auth/logout
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none (reads the `refreshToken` **cookie**)
- **Success response**:
```json
{ "success": true, "message": "Logged out." }
```
- **Errors**: only `protect` errors
- **Notes**: revokes the `Session` matched by `hash(refreshToken)` — or `req.sessionId` if no cookie — so the access token dies immediately; clears both cookies; sets `isOnline: false` and `lastSeen`.

### POST /api/auth/refresh
- **Auth**: none via `protect` — authenticated **by the httpOnly `refreshToken` cookie** (deliberately outside `protect` so it works after the access token expires)
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none (cookie only)
- **Success response**:
```json
{ "success": true, "token": "eyJ...", "user": { "...SafeUser": true } }
```
- **Errors**:
  - `401` → `"No refresh token."`
  - `401` → `"Session expired. Please log in again."` (invalid/revoked/idle-expired session; also clears cookies)
  - `401` → `"Account is not active."` (also revokes the session + clears cookies)
- **Notes**: rotates the refresh token (old one becomes unusable), mints a new access token bound to the same `sid`, resets both cookies.

### GET /api/auth/me
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "user": { "...SafeUser": true } }
```
- **Errors**: only `protect` errors
- **Notes**: returns `req.user.toSafeJSON()` — the document already loaded by `protect`, no extra query.

### GET /api/auth/sessions
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{
  "success": true,
  "sessions": [
    { "id": "66d4...", "device": "Chrome on Windows", "ip": "203.0.113.7",
      "lastActiveAt": "2026-07-29T10:00:00.000Z", "createdAt": "2026-07-20T08:00:00.000Z",
      "current": true }
  ]
}
```
- **Errors**: only `protect` errors
- **Notes**: only non-revoked, unexpired sessions, sorted by `lastActiveAt` desc. `current` compares against `req.sessionId`. `refreshHash`/`userAgent` are never exposed.

### POST /api/auth/sessions/revoke-others
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true }`
- **Errors**: only `protect` errors
- **Notes**: sets `revokedAt` on every other live session of the caller — those devices' access tokens stop working on their next request.

### DELETE /api/auth/sessions/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Session._id` to revoke
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true }`
- **Errors**: only `protect` errors (plus `400 "Invalid _id: ..."` from the CastError normalizer for a malformed id)
- **Notes**: the update is scoped `{ _id, user: req.user._id }`, so revoking someone else's session silently no-ops; **returns `success: true` even when nothing matched**. Revoking your own current session is allowed.

### POST /api/auth/forgot-password
- **Auth**: none
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `email` (string, required)
- **Success response**:
```json
{ "success": true, "message": "If that email exists, a reset link has been sent." }
```
- **Errors**: none thrown (deliberately identical response whether or not the account exists)
- **Notes**: stores `sha256(resetToken)` in `resetPasswordToken` with a 30-minute `resetPasswordExpires`, and emails `${CLIENT_URL}/reset-password/<rawToken>`.

### POST /api/auth/reset-password/:token
- **Auth**: none (the token is the credential)
- **Rate limit**: `authLimiter`
- **Path params**: `token` — the raw reset token from the email link
- **Query params**: none
- **Body**: `password` (string, required) — the new password
- **Success response** (`200`, `sendTokenResponse`):
```json
{ "success": true, "token": "eyJ...", "user": { "...SafeUser": true } }
```
- **Errors**:
  - `400` → `"Reset link is invalid or has expired."`
  - `400` → `"Password must be at least 8 characters."` (Mongoose `ValidationError` normalized by the error handler)
- **Notes**: bumps `tokenVersion` (invalidating every previously issued JWT), revokes **all** tracked sessions, then creates a fresh session for this device. `securityEvent('password.reset')`.

### PATCH /api/auth/change-password
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `currentPassword` (string, required); `newPassword` (string, required)
- **Success response** (`200`, `sendTokenResponse` with `extra`):
```json
{ "success": true, "token": "eyJ...", "user": { "...SafeUser": true }, "message": "Password updated." }
```
- **Errors**:
  - `401` → `"Current password is incorrect."`
  - `400` → `"Password must be at least 8 characters."` (Mongoose validation)
- **Notes**: bumps `tokenVersion`, revokes every live session, re-issues cookies/session for the current device. `securityEvent('password.change' | 'password.change.failure')`.

### POST /api/auth/two-step/enable
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `pin` (string|number, required) — 4–8 digits
- **Success response**: `{ "success": true, "twoStepEnabled": true }`
- **Errors**:
  - `400` → `"Your PIN must be 4 to 8 digits."`
  - `400` → `"Two-step is already on. Use \"change PIN\" instead."`
- **Notes**: stores `bcrypt.hash(pin, 10)` in `twoStepPin` (`select: false`). The same PIN gates chat lock (`POST /api/chats/locked`). `securityEvent('twostep.enable')`.

### POST /api/auth/two-step/change
- **Auth**: access token (`protect`)
- **Rate limit**: `authLimiter` (applied **after** `protect`)
- **Path params**: none
- **Query params**: none
- **Body**: `currentPin` (string|number, required); `newPin` (string|number, required) — 4–8 digits
- **Success response**: `{ "success": true, "twoStepEnabled": true }`
- **Errors**:
  - `400` → `"Your new PIN must be 4 to 8 digits."`
  - `400` → `"Two-step verification is not enabled."`
  - `400` → `"Your current PIN is incorrect."`
  - `400` → `"The new PIN must be different from the current one."`
- **Notes**: `securityEvent('twostep.change' | 'twostep.change.failure')`.

### POST /api/auth/two-step/disable
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `pin` (string|number, required only if two-step is currently on)
- **Success response**: `{ "success": true, "twoStepEnabled": false }`
- **Errors**: `400` → `"Incorrect PIN."`
- **Notes**: not rate-limited, unlike `/verify` and `/change`. Clears `twoStepPin` and sets `twoStepEnabled: false`. Any chats in `lockedChats` remain in that array but can no longer be revealed via `POST /api/chats/locked` (which requires an enabled PIN). `securityEvent('twostep.disable')`.

### POST /api/auth/two-step/verify
- **Auth**: access token (`protect`)
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `pin` (string|number, required)
- **Success response**: `{ "success": true, "verified": true }`
- **Errors**: `400` → `"Incorrect PIN."`
- **Notes**: returns `verified: true` immediately (no PIN needed) when `twoStepEnabled` is false. Purely a check — no server-side "unlocked" state is stored. `securityEvent('twostep.verify.failure')` on a wrong PIN.

### POST /api/auth/two-step/forgot
- **Auth**: access token (`protect`)
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "message": "We sent a verification code to ada@example.com.", "email": "ada@example.com", "devOtp": "123456" }
```
(`devOtp` only when SMTP unconfigured and not production)
- **Errors**: `400` → `"Two-step verification is not enabled."`
- **Notes**: writes `twoStepResetOtp` + 10-min `twoStepResetExpires`, resets `twoStepResetAttempts`, emails the OTP to the account address. `securityEvent('twostep.reset.requested')` (and `twostep.reset.email.failed` if the send failed).

### POST /api/auth/two-step/reset
- **Auth**: access token (`protect`)
- **Rate limit**: `authLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `pin` (string|number, required) — the new 4–8 digit PIN; `otp` (string|number, required) — code from `/two-step/forgot`
- **Success response**: `{ "success": true, "message": "Your PIN has been reset." }`
- **Errors**:
  - `400` → `"Your new PIN must be 4 to 8 digits."`
  - `400` → `"Two-step verification is not enabled."`
  - `400` → `"Request a reset code first."`
  - `429` → `"Too many incorrect attempts. Request a new code."` (`twoStepResetAttempts >= 5`)
  - `400` → `"Invalid verification code."`
  - `400` → `"Verification code has expired. Request a new one."`
- **Notes**: locked chats stay locked and open with the new PIN. `securityEvent('twostep.reset.success' | '.failure' | '.locked')`.

---

## Users — `/api/users`

`userRoutes.js` applies `router.use(protect)`, so **every** endpoint requires an access token. `GET /:id` is registered last, so `/search` and `/me/*` win. There is **no `GET /api/users/me`** — such a request falls through to `getUserById` with `id = "me"` and returns `400 "Invalid _id: me"`.

### GET /api/users/search
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: `q` (string, default `''`) — exact email / username / phone, or a partial name/username/email inside your own non-personal workspace
- **Body**: none
- **Success response**:
```json
{ "success": true, "users": [ { "...PublicUser": true } ] }
```
(`{ "success": true, "users": [] }` when `q` is blank)
- **Errors**: only `protect` errors
- **Notes**: global reachability by **exact** `email`/`username`/`phone` (phone matched with and without a leading `+`); partial regex search additionally over `{ workspace: req.user.workspace }` only when the caller's workspace `type !== 'personal'`. Excludes `req.user._id` and everyone in `req.user.blockedUsers`. Capped at 20 results. Each result passes through `applyPresencePrivacy` (so non-contacts get no `email`/`phone`, and `isOnline`/`lastSeen` honor privacy). Does **not** filter out users who blocked *you*.

### GET /api/users/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — target `User._id`
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "user": { "...PublicUser": true } }
```
- **Errors**: `404` → `"User not found."`; `400` → `"Invalid _id: <value>"` for a malformed id
- **Notes**: any user is viewable by id across workspaces (global reachability); presence/identifier privacy applied via `applyPresencePrivacy`. No block check.

### PATCH /api/users/me
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body** (whitelist — all optional, only keys `!== undefined` are applied):
  - `name` (string) — max 60 (schema)
  - `bio` (string) — max 160 (schema)
  - `avatar` (string) — `''`, a `data:image/(png|jpe?g|webp);base64,...` ≤ 500 000 chars, or an `https://` URL ≤ 2048 chars
  - `phone` (string) — normalized; `''` is passed through unchanged
  - `username` (string) — must be unique; schema enforces `^[a-z0-9_.]+$`, 3–30 chars
- **Success response**:
```json
{ "success": true, "user": { "...SafeUser": true } }
```
- **Errors**:
  - `400` → `"Invalid avatar image."`
  - `409` → `"That username is taken."`
  - `400` → `"Please provide a valid phone number (7–15 digits)."`
  - `409` → `"That phone number is already linked to another account."`
  - `400` → Mongoose `ValidationError` text (e.g. username charset / length)
- **Notes**: `runValidators: true`. Fields like `role`, `accountStatus`, `workspace`, `privacy`, `settings` cannot be set here.

### PATCH /api/users/me/privacy
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body** (whitelist `PRIVACY_KEYS`, all optional, **values are not validated**): `lastSeen`, `profilePhoto`, `about`, `status` (`'everyone' | 'contacts' | 'nobody'`), `readReceipts` (boolean), `groupAddPermission` (`'everyone' | 'contacts'`), `onlineStatus`
- **Success response**:
```json
{ "success": true,
  "privacy": { "lastSeen": "contacts", "profilePhoto": "everyone", "about": "everyone",
               "status": "contacts", "readReceipts": true,
               "groupAddPermission": "everyone", "onlineStatus": "everyone" } }
```
- **Errors**: only `protect` errors
- **Notes**: merges onto the existing `privacy` object; `markModified('privacy')` + `save({ validateBeforeSave: false })`. Unknown keys are dropped. Enforced later by `applyPresencePrivacy`, `markRead` (`readReceipts`) and `addMembers` (`groupAddPermission`).

### PATCH /api/users/me/presence
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `state` (string, required) — one of `available`, `away`, `busy`, `dnd`
- **Success response**: `{ "success": true, "presenceState": "dnd" }`
- **Errors**: `400` → `"Invalid presence state."`
- **Notes**: emits socket `presence-state` `{ userId, state }` **to the caller's own personal room** (`emitToUser(req.user._id, ...)`), not to contacts. `'dnd'` suppresses push/desktop notifications elsewhere in the app.

### PATCH /api/users/me/settings
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body** (whitelist `SETTINGS_KEYS`, all optional): `theme` (`'light' | 'dark' | 'system'`), `accent` (`'indigo' | 'violet' | 'cyan' | 'emerald' | 'rose' | 'amber'`), `notifications` (object: `messages`, `groups`, `calls`, `meetings`, `sound` booleans), `enterToSend` (boolean)
- **Success response**:
```json
{ "success": true,
  "settings": { "theme": "dark", "accent": "indigo",
                "notifications": { "messages": true, "groups": true, "calls": true, "meetings": true, "sound": true },
                "enterToSend": true } }
```
- **Errors**: `400` → `"Invalid theme."`; `400` → `"Invalid accent color."`
- **Notes**: `notifications` is replaced wholesale (not deep-merged) and its contents are not validated here (the sub-schema coerces booleans). Saved with `validateBeforeSave: false`.

### GET /api/users/me/export
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response** (`200`, `Content-Type: application/json`, `Content-Disposition: attachment; filename="chatconnect-export.json"`, pretty-printed via `res.send`, **no `success` wrapper**):
```json
{
  "exportedAt": "2026-07-29T10:00:00.000Z",
  "profile": { "name": "Ada Lovelace", "username": "ada", "email": "ada@example.com",
               "bio": "Available on ChatConnect", "phone": "+919876543210",
               "createdAt": "2026-01-01T00:00:00.000Z" },
  "contacts": [ { "name": "Grace Hopper", "username": "grace", "email": "grace@example.com" } ],
  "chats": [ { "id": "66b2...", "type": "group", "name": "Team Rocket", "createdAt": "2026-07-01T00:00:00.000Z" } ],
  "messages": [ { "chat": "66b2...", "type": "text", "content": "hey", "at": "2026-07-02T09:00:00.000Z" } ],
  "counts": { "contacts": 1, "chats": 1, "messages": 1 }
}
```
- **Errors**: only `protect` errors
- **Notes**: only the caller's **own** messages (`sender: uid`) are exported, so it can't exfiltrate a partner's content. `name` is `null` for direct chats.

### DELETE /api/users/me
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "message": "Account and associated data deleted." }
```
- **Errors**: only `protect` errors
- **Notes**: GDPR-style cascade, no confirmation required. For each chat the user belongs to: direct chats (and chats left with 0 members) are deleted along with all their `Message`s; group chats keep going with the user removed and ownership reassigned to `participants[0]` if the owner left. Then deletes their `Message`s (in surviving groups), `Status`, `ContactRequest` (both directions), `Notification` (as `user` or `from`), `Call` (initiator/participant), `Meeting` (as host) + pulls them from other meetings' participants, `Report` (as reporter), and `$pull`s their id from every other user's `contacts`/`favorites`/`blockedUsers`. Finally deletes the `User` and expires the `token` cookie — note the **`refreshToken` cookie is not cleared** and `Session` rows are not revoked (they become unusable because `protect` 401s with `"User no longer exists."`). Chat-list caches are **not** invalidated for remaining participants.

### GET /api/users/me/contacts
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response** (each entry selected as `name username email phone avatar bio isOnline lastSeen accountStatus createdAt` — **no privacy filtering applied**):
```json
{
  "success": true,
  "contacts": [ { "_id": "66a1...", "name": "Grace Hopper", "username": "grace",
                  "email": "grace@example.com", "phone": "+14155550123",
                  "avatar": "https://...", "bio": "…", "isOnline": false,
                  "lastSeen": "2026-07-28T22:10:00.000Z", "accountStatus": "active",
                  "createdAt": "2026-02-02T00:00:00.000Z" } ],
  "favorites": [ { "...same shape": true } ]
}
```
- **Errors**: only `protect` errors
- **Notes**: populates in place on the `req.user` doc loaded by `protect` (no second `findById`).

### POST /api/users/me/contacts/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — target `User._id`
- **Query params**: none
- **Body**: none read (unlike `/api/contacts/request/:userId`, this ignores `message`)
- **Success response** (`201`):
```json
{ "success": true, "message": "Contact request sent." }
```
or (`200`, when already connected):
```json
{ "success": true, "message": "Already a contact." }
```
- **Errors**:
  - `400` → `"You can't add yourself."`
  - `404` → `"User not found."`
  - `403` → `"You can only add people in your workspace."`
  - `403` → `"Unable to send a request to this user."` (block in either direction)
- **Notes**: consent-based — creates a **pending `ContactRequest`**, never a unilateral contact. Idempotent when a pending request already exists (no duplicate, no socket event). Emits socket `contact-request` `{ from: { _id, name, avatar } }` to the target. **Stricter than `/api/contacts/request/:userId`**: this route enforces same-workspace, that one allows cross-workspace requests. No push/in-app `notifyUser` here.

### DELETE /api/users/me/contacts/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `User._id` to remove
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "message": "Contact removed." }`
- **Errors**: only `protect` errors (`400` CastError for a malformed id)
- **Notes**: one-sided — `$pull`s from the caller's `contacts` **and** `favorites` only; the other user still lists the caller as a contact. No socket event, no cache invalidation. Succeeds even if the id was never a contact.

### POST /api/users/me/favorites/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `User._id` to toggle
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "favorited": true }`
- **Errors**: only `protect` errors
- **Notes**: toggle (`$addToSet` / `$pull` on `favorites`); does not verify the id is a real user or a contact.

### POST /api/users/me/block/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `User._id` to toggle
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "blocked": true }`
- **Errors**: only `protect` errors
- **Notes**: toggle on `blockedUsers`; affects search results and contact requests in both directions. Does not remove an existing contact link or delete chats. No socket event.

### POST /api/users/me/chats/:chatId/:action
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `chatId` — `Chat._id`; `action` — one of `pin`, `archive`, `mute`
- **Query params**: none
- **Body**: none
- **Success response** (the key is the literal `:action` value):
```json
{ "success": true, "pin": true }
```
- **Errors**: `400` → `"Unknown action."` (any `action` outside the three)
- **Notes**: toggles `pinnedChats` / `archivedChats` / `mutedChats` on the User doc. **Does not verify chat membership and does not invalidate the chat-list cache**, so the new flag may not appear in `GET /api/chats` until the cache TTL lapses or another write invalidates it.

---

## Contacts — `/api/contacts`

`router.use(protect)` — all endpoints require an access token.

### GET /api/contacts/requests
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response** (`from`/`to` populated with `name username email avatar bio isOnline lastSeen`):
```json
{
  "success": true,
  "incoming": [ { "_id": "66e5...", "from": { "_id": "66a1...", "name": "Grace Hopper", "username": "grace", "email": "grace@example.com", "avatar": "https://...", "bio": "…", "isOnline": true, "lastSeen": "…" }, "to": "66a2...", "status": "pending", "message": "Hi from the conference", "createdAt": "…", "updatedAt": "…", "__v": 0 } ],
  "outgoing": [ { "_id": "66e6...", "from": "66a2...", "to": { "_id": "66a3...", "name": "Alan Turing", "username": "alan", "email": "alan@example.com", "avatar": "https://...", "bio": "…", "isOnline": false, "lastSeen": "…" }, "status": "pending", "message": "", "createdAt": "…", "updatedAt": "…", "__v": 0 } ]
}
```
- **Errors**: only `protect` errors
- **Notes**: only `status: 'pending'` rows in both directions; no privacy filtering (email is always returned here).

### POST /api/contacts/request/:userId
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `userId` — recipient `User._id`
- **Query params**: none
- **Body**: `message` (string, optional) — note attached to the request
- **Success response** (`201`):
```json
{ "success": true, "request": { "_id": "66e5...", "from": "66a2...", "to": "66a1...", "status": "pending", "message": "Hi from the conference", "createdAt": "…", "updatedAt": "…", "__v": 0 } }
```
or (`200`, when the target had already sent *you* a pending request):
```json
{ "success": true, "request": { "_id": "66e4...", "from": "66a1...", "to": "66a2...", "status": "accepted", "message": "", "createdAt": "…", "updatedAt": "…", "__v": 0 }, "autoAccepted": true }
```
- **Errors**:
  - `400` → `"You can't add yourself."`
  - `404` → `"User not found."`
  - `403` → `"Unable to send a request to this user."` (block in either direction)
  - `409` → `"You are already connected."`
  - `409` → `"Request already sent."` (an existing `pending` request)
- **Notes**: cross-workspace requests are **allowed here** (global reachability), unlike `POST /api/users/me/contacts/:id`. Mutual-pending auto-accept adds each user to the other's `contacts`, emits socket `contact-accepted` `{ by }` to the other party and `notifyUser` (in-app Notification + Web Push, `type: 'contact_request'`, `url: '/contacts'`). Otherwise a stale `rejected`/`accepted` request doc is reused (reset to `pending`) so the unique `{from,to}` index never 500s and a rejection isn't permanent; emits `contact-request` `{ from: { _id, name, avatar } }` + `notifyUser`.

### PATCH /api/contacts/request/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `ContactRequest._id`
- **Query params**: none
- **Body**: `action` (string, required) — must be exactly `'accept'` or `'reject'`. Any other value (including a missing one) is a `400`; it is **not** silently treated as a reject, because rejection is terminal and would destroy the request.
- **Success response**:
```json
{ "success": true, "request": { "_id": "66e5...", "from": "66a1...", "to": "66a2...", "status": "accepted", "message": "", "createdAt": "…", "updatedAt": "…", "__v": 0 } }
```
- **Errors**:
  - `404` → `"Request not found."` (missing, or `request.to !== req.user._id`)
  - `400` → `"This request has already been handled."` (status not `pending`)
- **Notes**: ownership check — only the recipient can respond. On accept: `$addToSet` both directions of `contacts`, socket `contact-accepted` `{ by: req.user.name }` to the sender, plus `notifyUser` (Notification + push). On reject: status only, no notification. Chat-list caches are not touched (a new DM chat is only created later by `POST /api/chats/direct/:userId`).

---

## Chats — `/api/chats`

`router.use(protect)` — all endpoints require an access token.

### GET /api/chats
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none (no pagination)
- **Body**: none
- **Success response**:
```json
{
  "success": true,
  "chats": [ { "...ChatPopulated": true,
               "unreadCount": 3, "pinned": false, "archived": false, "muted": false } ]
}
```
- **Errors**: only `protect` errors
- **Notes**: read-through Redis cache (`utils/chatCache.js` — `getCachedChatList`/`setCachedChatList`); cached responses skip the per-user flag/unread recomputation entirely. Excludes `req.user.lockedChats`. Sorted `updatedAt` desc. `unreadCount` comes from one aggregation over all chats (messages not sent by you, not `isDeleted`, not in your `readBy`, not in your `deletedFor`). `pinned`/`archived`/`muted` are derived from the User doc's arrays.

### POST /api/chats/locked
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter` — **not** `authLimiter`, even though it takes the PIN
- **Path params**: none
- **Query params**: none
- **Body**: `pin` (string|number, required) — the two-step PIN
- **Success response**:
```json
{ "success": true, "chats": [ { "...ChatPopulated": true, "unreadCount": 0, "locked": true } ] }
```
- **Errors**: `403` → `"Incorrect PIN."` (also returned when two-step is not enabled or the PIN isn't 4–8 digits)
- **Notes**: PIN checked with `verifyTwoStepPin` (bcrypt) from `userController`. Separate cache namespace (`getCachedLockedChatList`/`setCachedLockedChatList`); note the cache is read **after** the PIN check, so it can't be bypassed. Returns only chats in `lockedChats` where the caller is still a participant.

### POST /api/chats/direct/:userId
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `userId` — the other participant's `User._id`
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**:
  - `400` → `"You can't chat with yourself."`
  - `404` → `"User not found."`
  - `403` → `"Send a contact request and get accepted before you can chat."` (only on **creation** — requires mutual contacts in both directions)
- **Notes**: get-or-create; an existing 1:1 chat is returned regardless of current contact state. New cross-workspace DMs are created with `workspace: null` (so workspace member-removal sweeps never touch them); same-workspace DMs keep the workspace tag. Invalidates the chat-list cache for **both** users. No socket event is emitted.

### POST /api/chats/:id/lock
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: none (the PIN is **not** required to lock)
- **Success response**: `{ "success": true, "locked": true }`
- **Errors**:
  - `403` → `"You are not a participant of this chat."` (also when the chat doesn't exist)
  - `400` → `"Set up a two-step PIN first to lock chats."`
- **Notes**: `$addToSet` on the caller's `lockedChats`; invalidates their chat-list cache (the chat moves out of `GET /api/chats` and into `POST /api/chats/locked`). Per-user, not per-chat — the other participant is unaffected.

### POST /api/chats/:id/unlock
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "locked": false }`
- **Errors**: only `protect` errors (`400` CastError for a malformed id)
- **Notes**: **no PIN and no membership check** — a blind `$pull` from `lockedChats`; succeeds even if the chat wasn't locked. Invalidates the caller's chat-list cache.

### GET /api/chats/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**: `404` → `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: no `unreadCount`/`pinned`/`archived`/`muted` fields (unlike the list endpoint). Locked chats are returned by id without a PIN.

### PATCH /api/chats/:id/disappearing
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: `seconds` (number, required) — `0` turns it off; clamped to `[0, 7776000]` (90 days); non-numeric coerces to `0`
- **Success response**: `{ "success": true, "disappearingSeconds": 604800 }`
- **Errors**: `403` → `"You are not a participant of this chat."` (also when the chat doesn't exist)
- **Notes**: **any member** can change the timer (no admin gate, groups included). Applies only to *future* messages, which get `expiresAt` and are removed by the Mongo TTL index. Emits socket `chat-disappearing` `{ chatId, seconds }` to the chat room; invalidates the chat-list cache for all participants.

### DELETE /api/chats/:id/clear
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "message": "Chat cleared for you." }`
- **Errors**: `403` → `"You are not a participant of this chat."` (also when the chat doesn't exist)
- **Notes**: clear-for-me only — `$addToSet: { deletedFor: req.user._id }` on every message; nothing is deleted for other participants. Invalidates the caller's chat-list cache. No socket event.

### DELETE /api/chats/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Chat._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "message": "Chat removed." }`
- **Errors**: `404` → `"Chat not found."`
- **Notes**: **no membership check.** For a group it removes the caller from `participants` (deleting the chat entirely if that empties it) — effectively a silent leave with **no system message and no `group-updated` socket event** (unlike `POST /api/groups/:id/leave`, and without the owner-reassignment step). For a 1:1 it just marks every message `deletedFor` the caller. Invalidates the chat-list cache for all prior participants (groups) or just the caller (direct).

---

## Messages — `/api/messages`

`router.use(protect)` — all endpoints require an access token. `GET /starred` is registered before `GET /:chatId`, so it isn't shadowed.

### POST /api/messages
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**:
  - `chatId` (string, required) — target chat; caller must be a participant
  - `content` (string, optional, default `''`) — max 10 000 chars
  - `type` (string, optional, default `'text'`) — one of `text`, `image`, `video`, `audio`, `voice`, `document`, `location` (`'system'`, `'poll'`, `'product'` are rejected)
  - `attachments` (array, optional) — max 20; each entry must have a `url` starting `/uploads/` or `https://`; only `url`, `name`, `size`, `mime`, `width`, `height`, `duration` are kept
  - `location` (object, optional) — `{ lat, lng, label }`
  - `replyTo` (string, optional) — `Message._id`, **not validated as same-chat**
  - `mentions` (array, optional) — `User._id`s, truncated to 100
  - `forwardedFrom` (string, optional) — original sender `User._id`
  - `viewOnce` (boolean, optional) — honored only for `type` `image`/`video`
- **Success response** (`201`):
```json
{ "success": true, "message": { "...MessagePopulated": true } }
```
- **Errors**:
  - `404` → `"Chat not found."`
  - `403` → `"You are not a participant of this chat."`
  - `403` → `"Only admins can send messages in this group."` (group with `messagingPolicy: 'admins'` and the caller's role lacks `GROUP_MANAGE`)
  - `400` → `"Invalid message type."`
  - `400` → `"Message text must be a string under 10000 characters."`
  - `400` → `"attachments must be a list."`
  - `400` → `"At most 20 attachments per message."`
  - `400` → `"Message cannot be empty."` (no content, no attachments, no location)
- **Notes**: stamps `expiresAt` when the chat has `disappearingSeconds > 0` (TTL index self-deletes). Sender is pre-marked in `deliveredTo` and `readBy`. Updates `chat.lastMessage` (an ObjectId ref) and thus `chat.updatedAt`. Invalidates the chat-list cache for **every** participant. Sockets: `receive-message` `{ chatId, message }` to each participant's **personal** room, plus `chat-updated` `{ chatId }` to everyone but the sender. `notifyUser` per recipient (in-app Notification + Web Push, `type: 'group_message' | 'message'`, `url: '/?chat=<id>'`). For direct chats also enqueues `automsg.maybe` (business greeting/away auto-reply).

### POST /api/messages/schedule
- **Auth**: access token (`protect`)
- **Body**: same payload as `POST /api/messages` (`chatId`, `content`, `type`, `attachments`, `location`, `replyTo`, `mentions`) — validated by the **same** `validateOutgoing()` the live path uses, so a scheduled message can never carry something a live send would reject — plus:
  - `sendAt` (date string, **required**) — must parse, and be at least **10 seconds** (`MIN_SCHEDULE_LEAD_MS`) in the future
- **Success response**: `201 { "success": true, "scheduled": { "_id": "…", "chat": "…", "sender": "…", "type": "text", "content": "…", "sendAt": "…", "status": "pending" } }`
- **Errors**:
  - `400 sendAt must be a valid date.`
  - `400 Pick a time at least a few seconds from now.`
  - `400 You can have at most 50 scheduled messages per chat.` (`MAX_PENDING_PER_CHAT`)
  - `404 Chat not found.` / `403` — not a participant, or a group with `messagingPolicy: 'admins'`
- **Notes**: pending rows live in a **separate `ScheduledMessage` collection**, never in `Message` — so they cannot leak into chat history, search, starred, unread counts or `chat.lastMessage`. `utils/scheduledDispatcher.js` polls every **30 s**, claims a due row with an atomic `findOneAndUpdate` (`pending → sending`) so multiple instances can't double-send, and re-checks chat membership at send time. A row stuck in `sending` for over **5 minutes** is treated as orphaned and reclaimed. Emits `scheduled-message` `{ id, chatId, status }` to the author's own devices.

### GET /api/messages/scheduled/:chatId
- **Auth**: access token (`protect`) + chat membership
- **Path params**: `chatId` — the chat whose queue to list
- **Success response**: `200 { "success": true, "scheduled": [ { "...ScheduledMessage": true } ] }` — **only the caller's own** rows, `status` in `pending`/`failed`, sorted by `sendAt` ascending
- **Errors**: `404 Chat not found.` / `403` not a participant

### DELETE /api/messages/scheduled/:id
- **Auth**: access token (`protect`) + row owner
- **Success response**: `200 { "success": true }`
- **Errors**: `404 That scheduled message is no longer pending.`
- **Notes**: the owner check and the still-cancellable state are both in the update **query** (`status: 'pending'` → `cancelled`), so a row the dispatcher has already claimed can't be yanked out from under it. Emits `scheduled-message` `{ status: 'cancelled' }`.

### POST /api/messages/poll
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `chatId` (string, required); `question` (string, required) — trimmed, max 300; `options` (array, required) — stringified, trimmed, de-duplicated, blanks dropped, sliced to 12, min 2, each max 150; `multi` (boolean, optional) — allow multiple selections
- **Success response** (`201`):
```json
{ "success": true,
  "message": { "...MessagePopulated": true, "type": "poll",
               "poll": { "question": "Lunch?", "options": [ { "text": "Pizza", "votes": [] }, { "text": "Sushi", "votes": [] } ], "multi": false, "closed": false } } }
```
- **Errors**:
  - `404` → `"Chat not found."`
  - `403` → `"You are not a participant of this chat."`
  - `403` → `"Only admins can post in this group."`
  - `400` → `"A poll needs a question."`
  - `400` → `"Poll question is too long (max 300 characters)."`
  - `400` → `"A poll needs at least two options."`
  - `400` → `"Poll options must be under 150 characters."`
- **Notes**: creates a `type: 'poll'` message, respects `disappearingSeconds`, sets `chat.lastMessage`, invalidates the chat-list cache for all participants, emits `receive-message` to every participant's personal room and `chat-updated` to everyone but the creator. **No `notifyUser` push/in-app notification** (unlike a normal send).

### POST /api/messages/read
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `chatId` (string, required)
- **Success response**: `{ "success": true }`
- **Errors**: `404` → `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: `$push`es `{ user, at }` into `readBy` for every message in the chat not sent by the caller and not already read by them. Emits socket `message-read` `{ chatId, userId }` to the chat room **only when `req.user.privacy.readReceipts !== false`** — the DB write happens either way. Invalidates the caller's chat-list cache (unread count drops to 0).

### GET /api/messages/starred
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "messages": [ { "...MessagePopulated": true } ] }
```
- **Errors**: only `protect` errors
- **Notes**: `Message.find({ starredBy: req.user._id })`, newest first, hard-capped at 100. **No membership re-check** — messages from chats the user has since left are still returned; `deletedFor` is not filtered out.

### GET /api/messages/:chatId
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `chatId` — `Chat._id`
- **Query params**: `before` (ISO date string, optional) — keyset pagination cursor, returns messages with `createdAt < before`; `limit` (number, default 40, max 100)
- **Body**: none
- **Success response** (ascending chronological order):
```json
{ "success": true, "messages": [ { "...MessagePopulated": true } ] }
```
- **Errors**: `404` → `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: excludes messages the caller has in `deletedFor`; `isDeleted` (deleted-for-everyone) messages **are** returned so the client can show the tombstone. Fetched `createdAt` desc + `.limit()` then `.reverse()`d. Locked chats are readable without a PIN.

### GET /api/messages/:chatId/search
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `chatId` — `Chat._id`
- **Query params**: `q` (string, default `''`) — substring, regex-escaped, case-insensitive
- **Body**: none
- **Success response**:
```json
{ "success": true, "messages": [ { "...MessagePopulated": true } ] }
```
(`{ "success": true, "messages": [] }` when `q` is blank)
- **Errors**: `404` → `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: matches `content` only (not attachment names / poll text), excludes `isDeleted` and the caller's `deletedFor`, newest first, capped at 50.

### PATCH /api/messages/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: none
- **Body**: `content` (string, optional) — new text, max 10 000 chars; if omitted the message is only re-stamped as edited
- **Success response**:
```json
{ "success": true, "message": { "...MessagePopulated": true, "isEdited": true, "editedAt": "2026-07-29T10:05:00.000Z" } }
```
- **Errors**:
  - `404` → `"Message not found."` / `"Chat not found."`
  - `403` → `"You are not a participant of this chat."`
  - `403` → `"You can only edit your own messages."`
  - `403` → `"Messages can only be edited within 5 minutes of sending."`
  - `400` → `"Message text must be a string under 10000 characters."`
- **Notes**: ownership + 5-minute window (`EDIT_WINDOW_MS`). Sets `isEdited: true`, `editedAt`. Emits socket `message-edited` `{ chatId, message }` to the chat room; invalidates only the editor's chat-list cache.

### DELETE /api/messages/:id
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: `scope` (string, default `'me'`) — `'everyone'` retracts for the whole chat; any other value means delete-for-me
- **Body**: none
- **Success response**: `{ "success": true }`
- **Errors**:
  - `404` → `"Message not found."` / `"Chat not found."`
  - `403` → `"You are not a participant of this chat."`
  - `403` → `"You can only delete your own messages for everyone."`
  - `403` → `"You can only delete for everyone within 5 minutes of sending. Delete for yourself instead."`
- **Notes**: `scope=everyone` sets `isDeleted: true` and blanks `content`/`attachments` (document kept as a tombstone), then emits `message-deleted` `{ chatId, messageId, scope }` to the chat room. `scope=me` just `$addToSet`s the caller into `deletedFor` (no socket event). Either way invalidates the caller's chat-list cache; `chat.lastMessage` is **not** rewritten.

### POST /api/messages/:id/react
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: none
- **Body**: `emoji` (string, required) — not validated/length-capped
- **Success response**:
```json
{ "success": true, "message": { "...MessagePopulated": true } }
```
- **Errors**: `404` → `"Message not found."` / `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: one reaction per user — same emoji again removes it, a different emoji replaces it. Emits socket `message-reaction` `{ chatId, messageId, reactions }` (populated reactions) to the chat room. No cache invalidation, no notification.

### POST /api/messages/:id/star
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "starred": true }`
- **Errors**: `404` → `"Message not found."` / `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: per-user toggle on `starredBy`; no socket event.

### POST /api/messages/:id/pin
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true, "pinned": true }`
- **Errors**: `404` → `"Message not found."` / `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: chat-level, not per-user — toggles `Chat.pinnedMessages`, so **any member** (no admin gate) pins for everyone. Emits socket `message-pinned` `{ chatId, messageId, pinned }` to the chat room.

### POST /api/messages/:id/vote
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — the poll `Message._id`
- **Query params**: none
- **Body**: `optionIndex` (number, required) — 0-based index into `poll.options`
- **Success response**:
```json
{ "success": true, "message": { "...MessagePopulated": true, "type": "poll",
  "poll": { "question": "Lunch?", "options": [ { "text": "Pizza", "votes": ["66a1..."] }, { "text": "Sushi", "votes": [] } ], "multi": false, "closed": false } } }
```
- **Errors**:
  - `404` → `"Poll not found."` (missing message, or not a poll)
  - `404` → `"Chat not found."`
  - `403` → `"You are not a participant of this chat."`
  - `400` → `"This poll is closed."`
  - `400` → `"Invalid poll option."` (non-integer or out of range)
- **Notes**: `multi: true` toggles just the clicked option; single-choice clears the voter from every option first (re-clicking the same option clears the vote). Emits socket `message-updated` `{ chatId, message }` to the chat room. There is no endpoint in these files to *close* a poll.

### POST /api/messages/:id/viewed
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — `Message._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true }`
- **Errors**: `404` → `"Message not found."` / `"Chat not found."`; `403` → `"You are not a participant of this chat."`
- **Notes**: no-op `{ success: true }` when the message isn't `viewOnce` or the caller is the sender. Adds the caller to `viewedBy`; once `viewedBy.length >= (participants excluding the sender)`, the media is purged (`attachments: []`, `content: ''`). Emits socket `message-updated` `{ chatId, message }` to the chat room only on the first view by that user.

---

## Groups — `/api/groups`

`router.use(protect)` — all endpoints require an access token. Group permissions come from the per-chat `participant.role` via `groupCan()` (`utils/rbac.js`): `owner` and `admin` hold `GROUP_MANAGE`/`GROUP_MEMBERS`/`GROUP_POST`; `member` holds only `GROUP_POST`. Every gate below uses `requireGroupPerm(chat, userId, GROUP_MANAGE)` and fails with the same message.

### POST /api/groups
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: none
- **Query params**: none
- **Body**: `name` (string, required) — max 80 (schema); `description` (string, optional, default `''`) — max 500; `avatar` (string, optional, default `''`) — falls back to a generated DiceBear `shapes` URL; `members` (array of `User._id`, optional, default `[]`)
- **Success response** (`201`; `participants.user` populated with `name username email avatar bio isOnline lastSeen`):
```json
{ "success": true, "chat": { "...ChatPopulated": true, "isGroup": true, "inviteCode": "K7PQ2M9XZT" } }
```
- **Errors**: `400` → `"Group name is required."`; `400` → `"members must be a list."`
- **Notes**: the creator becomes `role: 'owner'`; requested members are de-duplicated, self-filtered, and **silently dropped unless they share the creator's `workspace`** (tenant isolation — no error for the dropped ones). `groupAddPermission` is **not** honored at creation (only in `addMembers`). `inviteCode` is auto-generated (10 chars, CSPRNG) by the Chat pre-save hook. Posts a `type: 'system'` message `"<name> created “<group>”"` (`systemEvent: 'group_created'`) which becomes `lastMessage`, and emits `receive-message` to the chat room plus `chat-updated` `{ chatId }` to every participant's personal room. **Does not invalidate the chat-list cache.**

### POST /api/groups/join/:inviteCode
- **Auth**: access token (`protect`)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `inviteCode` — the group's `inviteCode`
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
or (when already a member — note the chat is **not** populated on this branch):
```json
{ "success": true, "chat": { "_id": "66b2...", "isGroup": true, "participants": [ { "user": "66a1...", "role": "owner", "joinedAt": "…" } ], "name": "Team Rocket", "inviteCode": "K7PQ2M9XZT" }, "alreadyMember": true }
```
- **Errors**: `404` → `"Invite is invalid."`; `403` → `"This group belongs to another workspace."`
- **Notes**: joins with `role: 'member'`; posts a system message `"<name> joined via invite link"` (`systemEvent: 'member_joined'`) which emits `receive-message` to the chat room. Groups with `workspace: null` are joinable from any workspace. No `group-updated` event, no cache invalidation.

### PATCH /api/groups/:id
- **Auth**: access token (`protect`) + group `GROUP_MANAGE` (owner/admin)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — group `Chat._id`
- **Query params**: none
- **Body** (all optional, applied when `!== undefined`): `name` (string) — max 80; `description` (string) — max 500; `avatar` (string) — **not validated** here; `messagingPolicy` (string) — `'all' | 'admins'` (enum enforced by Mongoose)
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**: `404` → `"Group not found."` (missing or not `isGroup`); `403` → `"Admin privileges required."`; `400` → Mongoose `ValidationError` text (e.g. bad `messagingPolicy`, over-long `name`)
- **Notes**: emits socket `group-updated` `{ chat }` (full populated chat) to the chat room. No cache invalidation, so `GET /api/chats` may serve a stale name/avatar until the TTL lapses.

### POST /api/groups/:id/members
- **Auth**: access token (`protect`) + group `GROUP_MANAGE` (owner/admin)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — group `Chat._id`
- **Query params**: none
- **Body**: `members` (array of `User._id`, optional) — ids to add
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**: `404` → `"Group not found."`; `403` → `"Admin privileges required."`; `400` → `"members must be a list."`
- **Notes**: existing participants are filtered out; candidates must be in the **group's** `workspace`; each invitee's `privacy.groupAddPermission === 'contacts'` means they're added only if the caller is in their `contacts`. Rejected invitees are dropped silently. New members get `role: 'member'`. If anyone was added: system message `"<name> added A, B"` (`systemEvent: 'member_added'`) → `receive-message` to the chat room. Emits `chat-updated` `{ chatId }` to each added user's personal room and `group-updated` `{ chat }` to the chat room. No cache invalidation.

### DELETE /api/groups/:id/members/:userId
- **Auth**: access token (`protect`) + group `GROUP_MANAGE` (owner/admin)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — group `Chat._id`; `userId` — `User._id` to remove
- **Query params**: none
- **Body**: none
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**: `404` → `"Group not found."`; `403` → `"Admin privileges required."`; `400` → `"The group owner can't be removed."`
- **Notes**: the owner is protected even from themselves (they must use `POST /:id/leave`, which reassigns ownership). Removing a non-member silently succeeds. System message `"<name> was removed"` (`systemEvent: 'member_removed'`) only when the target User doc still exists. Emits `chat-updated` `{ chatId }` to the removed user and `group-updated` `{ chat }` to the chat room. No cache invalidation.

### PATCH /api/groups/:id/members/:userId/role
- **Auth**: access token (`protect`) + group `GROUP_MANAGE` (owner/admin)
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — group `Chat._id`; `userId` — target member's `User._id`
- **Query params**: none
- **Body**: `role` (string, required) — `'admin'` or `'member'` (`'owner'` is rejected)
- **Success response**:
```json
{ "success": true, "chat": { "...ChatPopulated": true } }
```
- **Errors**: `404` → `"Group not found."`; `403` → `"Admin privileges required."`; `400` → `"Invalid role."`; `404` → `"Member not found."`; `400` → `"Owner's role can't be changed."`
- **Notes**: an admin can promote/demote other admins (including the one who promoted them); only the owner role is protected. Emits `group-updated` `{ chat }` to the chat room. No system message, no cache invalidation.

### POST /api/groups/:id/leave
- **Auth**: access token (`protect`) — must be a participant; no role required
- **Rate limit**: none beyond `apiLimiter`
- **Path params**: `id` — group `Chat._id`
- **Query params**: none
- **Body**: none
- **Success response**: `{ "success": true }`
  or, when the caller was the last member: `{ "success": true, "deleted": true }`
- **Errors**: `404` → `"Group not found."`; `403` → `"You are not a member of this group."`
- **Notes**: if the owner leaves, `participants[0]` (earliest remaining) is promoted to `owner`. Emptying the group deletes the `Chat` (its `Message`s are **not** deleted). Otherwise posts a system message `"<name> left the group"` (`systemEvent: 'member_left'`, emits `receive-message`) and emits `group-updated` `{ chatId }` — note this payload carries `chatId`, not the full `chat` object that the other group endpoints send. No cache invalidation.
agentId: a3abf3cfa46efba90 (use SendMessage with to: 'a3abf3cfa46efba90', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 115545
tool_uses: 27
duration_ms: 370017</usage>
---

# Feature resources

## Calls (`/api/calls`)

Router-level `router.use(protect)` — every endpoint requires an access token.

A `call` object is the full `Call` document (`models/Call.js`) with the `callType` virtual:

```json
{
  "_id": "66a1f0c2e4b0a1d2c3e4f501",
  "type": "video",
  "isGroup": false,
  "chat": null,
  "initiator": "66a1e0aabbccddee00110022",
  "caller": "66a1e0aabbccddee00110022",
  "receiver": "66a1e0aabbccddee00110033",
  "participants": [
    { "user": "66a1e0aabbccddee00110022", "status": "joined", "joinedAt": "2026-07-29T10:00:00.000Z" },
    { "user": "66a1e0aabbccddee00110033", "status": "ringing" }
  ],
  "status": "ringing",
  "startedAt": "2026-07-29T10:00:00.000Z",
  "duration": 0,
  "createdAt": "2026-07-29T10:00:00.000Z",
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "callType": "video",
  "id": "66a1f0c2e4b0a1d2c3e4f501"
}
```

### GET /api/calls
### GET /api/calls/history
Both paths map to the same handler `getCallHistory`.

- **Auth**: access token (`protect`)
- **Path params**: none
- **Query params**: none (result is hard-capped at 100, sorted `createdAt` desc)
- **Body**: none
- **Success response**: `200`

```json
{
  "success": true,
  "calls": [
    {
      "_id": "66a1f0c2e4b0a1d2c3e4f501",
      "type": "video",
      "isGroup": false,
      "status": "completed",
      "duration": 132,
      "initiator": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "", "isOnline": true },
      "caller":    { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "", "isOnline": true },
      "receiver":  { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "isOnline": false },
      "participants": [ { "user": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "isOnline": false }, "status": "joined" } ],
      "startedAt": "2026-07-29T10:00:00.000Z",
      "endedAt": "2026-07-29T10:02:12.000Z",
      "createdAt": "2026-07-29T10:00:00.000Z",
      "callType": "video",
      "direction": "outgoing",
      "peer": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "isOnline": false }
    }
  ]
}
```

- **Errors**: none beyond the shared `protect` errors
- **Notes**: matches calls where the user is `initiator`, `receiver`, or in `participants.user`. `direction` and `peer` are computed per record (not stored). Populated user fields are `name username avatar isOnline`.

### POST /api/calls/start
- **Auth**: access token (`protect`)
- **Body**:
  - `receiverId` (string ObjectId, **required**) — the callee
  - `callType` (string, optional) — `"video"` selects video; anything else → `audio`
  - `type` (string, optional) — accepted as an alias for `callType` (`"video"`)
- **Success response**: `201`

```json
{ "success": true, "call": { "...": "Call document (status 'ringing' or 'missed')" }, "receiverOnline": true }
```

- **Errors**:
  - `400 receiverId is required.`
  - `400 You can't call yourself.`
  - `404 User not found.` (receiver does not exist)
  - `403 You can only call your contacts.` (not a **mutual** contact)
- **Notes**: creates the Call record *before* signaling. If the receiver has no live socket (`isUserOnline`), the record is created with `status:'missed'` + `endedAt`. Fires `notifyUser` for the receiver (`incoming_call` or `missed_call`) → persists a `Notification` and sends Web Push with `tag: "call:<id>"`, `url: "/calls"`, `data.callId`. No `call:incoming` socket event from this endpoint (the client's socket signaling does the ringing).

### POST /api/calls/end
- **Auth**: access token (`protect`)
- **Body**:
  - `callId` (string ObjectId, **required**)
  - `duration` (number, optional) — seconds; ignored unless finite and ≥ 0, otherwise computed from `answeredAt`
- **Success response**: `200 { "success": true, "call": { "...": "Call document" } }`
- **Errors**: `404 Call not found.` (unknown id, invalid ObjectId, or caller not involved in the call)
- **Notes**: delegates to `transitionCall(..., 'end')` (`utils/callService.js`) — shared with the socket signaling handlers. A live call (`accepted`/`ongoing`) becomes `completed` and the caller's participant row becomes `left`; hanging up while still `ringing` becomes `missed`. Terminal states (`completed`/`missed`/`rejected`) never regress (idempotent).

### POST /api/calls/missed
- **Auth**: access token (`protect`)
- **Body**: `callId` (string ObjectId, **required**)
- **Success response**: `200 { "success": true, "call": { "...": "Call document" } }`
- **Errors**: `404 Call not found.`
- **Notes**: `transitionCall(..., 'missed')` — only a still-`ringing` call flips to `missed`. If the record has a `receiver` other than the requester, sends a `missed_call` notification + Web Push to them.

### POST /api/calls/reject
- **Auth**: access token (`protect`)
- **Body**: `callId` (string ObjectId, **required**)
- **Success response**: `200 { "success": true, "call": { "...": "Call document" } }`
- **Errors**: `404 Call not found.`
- **Notes**: `transitionCall(..., 'reject')` → `status:'rejected'`, `endedAt` set, requester's participant row `rejected`.

### POST /api/calls
Legacy / group entry point (`startCall`). Also exposed as `POST /api/v1/calls`.

- **Auth**: access token (`protect`)
- **Body**:
  - `type` (string, optional, default `"audio"`) — `audio` | `video` (Mongoose enum)
  - `chatId` (string ObjectId, optional) — required together with `isGroup:true` for the group path
  - `participants` (array of user ObjectIds, optional, default `[]`)
  - `isGroup` (boolean, optional, default `false`)
- **Success response**: `201 { "success": true, "call": { "...": "Call document, status 'ringing'" } }`
- **Errors**:
  - `400 participants must be a list.` (non-array `participants`)
  - `403 You are not a member of this group.` (group path, requester not in `chatId`)
  - `403 No reachable participants for this call.` (nothing survives the reachability filter)
- **Notes**: **reachability filter** — group path keeps only ids that are members of `chatId`; 1:1 path keeps only **mutual** contacts. `receiver` is set only when `!isGroup` and exactly one target survives. Emits socket `call:incoming` (`{ callId, from:{_id,name,avatar}, type, isGroup, chatId }`) to each allowed user's personal room, plus an `incoming_call` notification + Web Push each.

### PATCH /api/calls/:id
Legacy status/duration update (`updateCall`).

- **Auth**: access token (`protect`)
- **Path params**: `id` — Call `_id`
- **Body**:
  - `status` (string, optional) — written straight onto the document; validated by the Mongoose enum on `save()` (`ringing`|`accepted`|`ongoing`|`completed`|`missed`|`rejected`), an invalid value surfaces as `400` from the central handler
  - `duration` (number, optional) — seconds; applied when not `null`/`undefined`
- **Success response**: `200 { "success": true, "call": { "...": "Call document" } }`
- **Errors**:
  - `404 Call not found.`
  - `403 You are not part of this call.` (not `initiator` and not in `participants`)
- **Notes**: setting `status` to `completed`/`missed`/`rejected` also stamps `endedAt`. Unlike the `/end` etc. endpoints this bypasses `transitionCall`, so terminal states *can* be overwritten here.

---

## Meetings (`/api/meetings`)

Router-level `router.use(protect)`.

Populated `meeting` objects populate `host` and `participants.user` with `name username avatar email`.

### GET /api/meetings
- **Auth**: access token (`protect`)
- **Query params**: none
- **Success response**: `200`

```json
{
  "success": true,
  "meetings": [
    {
      "_id": "66a2b1c2d3e4f5a6b7c8d9e0",
      "title": "Sprint review",
      "description": "Demo + retro",
      "host": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "", "email": "abhishek@capyngen.com" },
      "participants": [
        { "user": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "email": "priya@capyngen.com" }, "response": "going", "viaLink": false }
      ],
      "startAt": "2026-08-01T09:00:00.000Z",
      "durationMinutes": 30,
      "timezone": "Asia/Kolkata",
      "type": "video",
      "roomCode": "abc-defg-hij",
      "link": "https://app.example.com/meet/abc-defg-hij",
      "settings": { "joinAnytime": true, "muteOnEntry": false, "autoRecord": false, "askToJoin": true },
      "recurrence": "none",
      "reminderMinutes": 10,
      "status": "scheduled",
      "startedAt": null,
      "createdAt": "2026-07-29T08:00:00.000Z",
      "updatedAt": "2026-07-29T08:00:00.000Z",
      "attendeeCount": 0,
      "durationSeconds": 0,
      "attendees": []
    }
  ]
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: returns meetings where the user is `host` **or** in `participants.user`, sorted `startAt` asc. `attendeeCount` and `durationSeconds` (from `startedAt`→`endedAt`) are computed. **The detailed `attendees` array is deleted for non-hosts.** Also exposed as `GET /api/v1/meetings`.

### POST /api/meetings
Also exposed as `POST /api/v1/meetings`.

- **Auth**: access token (`protect`)
- **Body**:
  - `title` (string, optional) — trimmed; empty → `"Instant meeting"`; max 120 chars (schema)
  - `description` (string, optional) — max 1000 (schema)
  - `startAt` (date string, optional) — **omitting it creates an instant meeting**: `startAt = now`, `status = 'ongoing'`
  - `durationMinutes` (number, optional, default 30)
  - `timezone` (string, optional, default `"UTC"`) — truncated to 64 chars
  - `type` (string, optional) — `audio` | `video` (schema default `video`)
  - `participants` (array of user ObjectIds, optional, default `[]`) — pre-invites; **filtered to users in the requester's own workspace**; requester's own id removed
  - `recurrence` (string, optional) — `none` | `daily` | `weekly` | `monthly`
  - `reminderMinutes` (number, optional, default 10)
  - `chatId` (string ObjectId, optional) — stored as `meeting.chat`
  - `inviteEmails` (array of strings, optional, default `[]`) — raw email invitations
  - `settings` (object, optional) — whitelisted booleans only: `joinAnytime`, `muteOnEntry`, `autoRecord`, `askToJoin`
- **Success response**: `201 { "success": true, "meeting": { "...": "populated meeting (same shape as GET /api/meetings item, without attendeeCount/durationSeconds)" }, "invitesQueued": 2 }`
  - `invitesQueued` — how many **valid, de-duplicated** addresses were handed to the
    mailer (invitees' own emails + `inviteEmails`). Malformed addresses are dropped, so
    this can be lower than the number supplied. It confirms the invites were *queued*,
    not that they were delivered — sending is fire-and-forget.
- **Errors**:
  - `400 participants must be a list.`
  - `400 inviteEmails must be a list.`
  - `500 Could not allocate a meeting room. Please retry.` (5 consecutive `roomCode` collisions)
- **Notes**: allocates an unguessable `roomCode` (`abc-defg-hij`) and `link = <CLIENT_URL>/meet/<roomCode>`. Emits socket `meeting-invited` (`{ meetingId, title, startAt }`) to each in-workspace invitee and a `meeting_reminder` notification + Web Push. Fire-and-forget email invites (max 50 unique valid addresses) to invitees' emails + `inviteEmails`, with an `invite.ics` calendar attachment (`utils/ics.js`). Each send's outcome is logged (`✉️  meeting invite sent to …` / `… FAILED [auth|connection|other]` / a warning when no mailer is configured) — invites never fail the request. Host is **not** added to `participants`. **`CLIENT_URL` must be set**, or the emailed join link is a broken relative path.

### GET /api/meetings/code/:code
- **Auth**: access token (`protect`)
- **Path params**: `code` — the shareable `roomCode` **or** the raw meeting `_id` ("join by meeting ID")
- **Success response**: `200`

```json
{
  "success": true,
  "meeting": {
    "_id": "66a2b1c2d3e4f5a6b7c8d9e0",
    "title": "Sprint review",
    "type": "video",
    "status": "ongoing",
    "startAt": "2026-08-01T09:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "roomCode": "abc-defg-hij",
    "host": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
    "settings": { "joinAnytime": true, "muteOnEntry": false, "autoRecord": false, "askToJoin": true },
    "isHost": false
  }
}
```

- **Errors**:
  - `404 This meeting link is invalid or has expired.`
  - `410 This meeting has been cancelled.`
- **Notes**: pre-join summary for anyone signed in who holds the link. `host` populated with `name username avatar` only. No mutation.

### GET /api/meetings/code/:code/rtc
- **Auth**: access token (`protect`)
- **Path params**: `code` — room code or meeting `_id`
- **Query params**: `pass` (string JWT, optional) — a signed `meet-admit` admission pass issued by the socket `meeting:admit` handler
- **Success responses**: `200`, one of three shapes
  - LiveKit not configured: `{ "success": true, "enabled": false }`
  - configured but caller not admitted: `{ "success": true, "enabled": true, "requiresAdmission": true }`
  - admitted:

```json
{
  "success": true,
  "enabled": true,
  "url": "wss://my-livekit.example.com",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "room": "mtg_66a2b1c2d3e4f5a6b7c8d9e0"
}
```

- **Errors**:
  - `404 This meeting link is invalid or has expired.`
  - `410 This meeting has been cancelled.`
- **Notes**: media-transport config. **Admission gate mirrors the socket `meeting:join` handler**: admitted if host, a *non-`viaLink`* participant, `settings.askToJoin === false`, or a valid `pass` whose `scope === 'meet-admit'`, `id === req.user._id` and `meetingId === meeting._id`. Un-admitted callers get `requiresAdmission` (not an error) and are expected to knock over the socket. LiveKit token: 3h TTL, identity `<userId>_<rand>`, `roomAdmin` only for the host (`utils/livekit.js`).

### POST /api/meetings/code/:code/join
- **Auth**: access token (`protect`)
- **Path params**: `code` — room code or meeting `_id`
- **Body**: none read
- **Success response**: `200 { "success": true, "meeting": { "...": "populated meeting" } }`
- **Errors**:
  - `404 This meeting link is invalid or has expired.`
  - `410 This meeting has been cancelled.`
- **Notes**: any signed-in user with the link may join (Google-Meet style). Adds `{ user, response:'going', viaLink:true }` to `participants` unless already present or host — `viaLink:true` means they still have to knock through the ask-to-join gate. A `scheduled` meeting flips to `ongoing`. No socket events emitted here.

### GET /api/meetings/:id/report
- **Auth**: access token (`protect`) + **host only**
- **Path params**: `id` — Meeting `_id`
- **Success response**: `200`

```json
{
  "success": true,
  "report": {
    "_id": "66a2b1c2d3e4f5a6b7c8d9e0",
    "title": "Sprint review",
    "type": "video",
    "host": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "", "email": "abhishek@capyngen.com" },
    "status": "completed",
    "scheduledAt": "2026-08-01T09:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "startedAt": "2026-08-01T09:01:10.000Z",
    "endedAt": "2026-08-01T09:34:02.000Z",
    "durationSeconds": 1972,
    "attendeeCount": 2,
    "attendees": [
      { "name": "Priya", "email": "priya@capyngen.com", "joinedAt": "2026-08-01T09:01:20.000Z", "leftAt": "2026-08-01T09:33:50.000Z", "durationSeconds": 1950 }
    ]
  }
}
```

- **Errors**:
  - `404 Meeting not found.`
  - `403 Only the host can view the attendance report.`
- **Notes**: `attendees` sorted by `joinedAt` asc; rows are written by the socket meeting-room handlers, not by REST.

### PATCH /api/meetings/:id
- **Auth**: access token (`protect`) + **host only**
- **Path params**: `id` — Meeting `_id`
- **Body** (mass-assignment whitelist — `host`/`participants`/`link`/`chat`/`status`/`roomCode` can never be set here):
  - `title`, `description`, `startAt`, `durationMinutes`, `timezone`, `type`, `recurrence`, `reminderMinutes` (each optional; applied when `!== undefined`)
  - `settings` (object, optional) — merged over existing settings, whitelisted booleans `joinAnytime`, `muteOnEntry`, `autoRecord`, `askToJoin`
- **Success response**: `200 { "success": true, "meeting": { "...": "populated meeting" } }`
- **Errors**:
  - `404 Meeting not found.`
  - `403 Only the host can edit this meeting.`
  - `400` from Mongoose validation (e.g. bad `type`/`recurrence` enum, `title` > 120 chars)
- **Notes**: no socket events / no re-invite emails.

### POST /api/meetings/:id/rsvp
- **Auth**: access token (`protect`)
- **Path params**: `id` — Meeting `_id`
- **Body**: `response` (string, **required**) — one of `going`, `maybe`, `not_going`
- **Success response**: `200 { "success": true, "meeting": { "...": "populated meeting" } }`
- **Errors**:
  - `400 Invalid RSVP.`
  - `404 Meeting not found.`
  - `403 You have not been invited to this meeting.` (not on `participants` and not the host)
- **Notes**: updates the existing participant row, or pushes a new row when the **host** RSVPs.

### DELETE /api/meetings/:id
- **Auth**: access token (`protect`) + **host only**
- **Path params**: `id` — Meeting `_id`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Meeting not found.`
  - `403 Only the host can cancel.`
- **Notes**: soft cancel — sets `status:'cancelled'` (the document is kept, and the code/link endpoints then return `410`). No socket events, no cancellation email.

---

## Status / Stories (`/api/status`)

Router-level `router.use(protect)`.

Audience model (`canView`): the owner always; otherwise the viewer must be a **contact** of the owner *and* pass `privacy.type` — `everyone`/`contacts` → any contact, `selected` → only ids in `privacy.allow`, `except` → contacts minus `privacy.except`.

### GET /api/status
- **Auth**: access token (`protect`)
- **Query params**: none
- **Success response**: `200`

```json
{
  "success": true,
  "feed": [
    {
      "user": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
      "seenAll": false,
      "items": [
        {
          "_id": "66a3c0d1e2f3a4b5c6d7e8f9",
          "user": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
          "type": "image",
          "content": "Launch day",
          "media": "/uploads/shot-1753790000000-123456789.png",
          "background": "linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)",
          "viewers": [ { "user": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "" }, "at": "2026-07-29T11:02:00.000Z" } ],
          "replies": [ { "user": "66a1e0aabbccddee00110033", "text": "Nice!", "at": "2026-07-29T11:03:00.000Z" } ],
          "privacy": { "type": "contacts", "allow": [], "except": [] },
          "expiresAt": "2026-07-30T11:00:00.000Z",
          "createdAt": "2026-07-29T11:00:00.000Z",
          "updatedAt": "2026-07-29T11:00:00.000Z"
        }
      ]
    }
  ]
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: candidate set is the user's own statuses + their contacts', newest first, then filtered per-status by `canView`, then grouped by owner. **Privacy: `viewers` and `replies` are deleted from any status the requester does not own.** `seenAll` is always `false` (client-side concern). Statuses self-delete 24h after creation via a TTL index.

### POST /api/status
- **Auth**: access token (`protect`)
- **Body**:
  - `type` (string, optional, default `"text"`) — `text` | `image` | `video` (Mongoose enum)
  - `content` (string, optional) — caption / text body
  - `media` (string, optional) — URL, typically `/uploads/…` from `POST /api/upload`
  - `background` (string, optional) — CSS background for text statuses
  - `privacy` (object, optional) — `{ type: 'everyone'|'contacts'|'selected'|'except', allow: [userId], except: [userId] }`; falsy → schema default (`contacts`)
- **Success response**: `201`

```json
{
  "success": true,
  "status": {
    "_id": "66a3c0d1e2f3a4b5c6d7e8f9",
    "user": "66a1e0aabbccddee00110022",
    "type": "text",
    "content": "Shipping today 🚀",
    "media": "",
    "background": "linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)",
    "viewers": [],
    "replies": [],
    "privacy": { "type": "contacts", "allow": [], "except": [] },
    "expiresAt": "2026-07-30T11:00:00.000Z",
    "createdAt": "2026-07-29T11:00:00.000Z",
    "updatedAt": "2026-07-29T11:00:00.000Z"
  }
}
```

- **Errors**: `400` from Mongoose validation (invalid `type`/`privacy.type` enum)
- **Notes**: `privacy` is stored as sent (no field whitelisting). Fire-and-forget fan-out: emits socket `status-updated` (`{ userId }`) to every contact allowed by the audience — a content-free hint, so clients refetch the feed and privacy is re-applied server-side.

### POST /api/status/:id/view
- **Auth**: access token (`protect`)
- **Path params**: `id` — Status `_id`
- **Body**: none read
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Status not found.`
  - `403 You are not allowed to see this status.` (fails the owner's audience check)
- **Notes**: idempotent — appends `{ user, at }` to `viewers` only if absent.

### POST /api/status/:id/reply
- **Auth**: access token (`protect`)
- **Path params**: `id` — Status `_id`
- **Body**: `text` (string, optional in code — stored verbatim, and `undefined` is accepted)
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Status not found.`
  - `403 You are not allowed to see this status.`
- **Notes**: pushes `{ user, text, at }` onto `replies` and emits socket `status-reply` (`{ from: <replier name>, text }`) to the **owner's** personal room. No push notification.

### GET /api/status/:id/viewers
- **Auth**: access token (`protect`) + **owner only**
- **Path params**: `id` — Status `_id`
- **Success response**: `200`

```json
{
  "success": true,
  "viewers": [
    { "user": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "" }, "at": "2026-07-29T11:02:00.000Z" }
  ]
}
```

- **Errors**:
  - `404 Status not found.`
  - `403 Not your status.`

### DELETE /api/status/:id
- **Auth**: access token (`protect`) + **owner only**
- **Path params**: `id` — Status `_id`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Status not found.`
  - `403 Not your status.`
- **Notes**: hard delete. Re-emits `status-updated` to the audience so contacts drop it live.

---

## Notifications (`/api/notifications`)

Router-level `router.use(protect)`.

### GET /api/notifications
- **Auth**: access token (`protect`)
- **Query params**: none (capped at 50, `createdAt` desc)
- **Success response**: `200`

```json
{
  "success": true,
  "notifications": [
    {
      "_id": "66a4d0e1f2a3b4c5d6e7f801",
      "user": "66a1e0aabbccddee00110022",
      "from": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "" },
      "type": "message",
      "title": "Priya",
      "body": "See you at 5",
      "data": { "chatId": "66a0aaaabbbbccccddddeee1" },
      "isRead": false,
      "createdAt": "2026-07-29T12:00:00.000Z",
      "updatedAt": "2026-07-29T12:00:00.000Z"
    }
  ],
  "unread": 3
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: `type` enum: `message`, `group_message`, `mention`, `incoming_call`, `missed_call`, `meeting_reminder`, `status_reply`, `contact_request`, `system`. Rows are written asynchronously by `utils/notify.js` (BullMQ when Redis is configured, else inline).

### PATCH /api/notifications/read
- **Auth**: access token (`protect`)
- **Body**: none read
- **Success response**: `200 { "success": true }`
- **Errors**: none beyond shared `protect` errors
- **Notes**: `updateMany({ user: me, isRead: false }, { isRead: true })`.

### PATCH /api/notifications/:id/read
- **Auth**: access token (`protect`)
- **Path params**: `id` — Notification `_id`
- **Success response**: `200 { "success": true }`
- **Errors**: `400 Invalid _id: …` for a malformed ObjectId (CastError). **No 404** — an unknown or foreign id silently succeeds (the query is scoped to `user: req.user._id`).

---

## Web Push (`/api/push`)

Router-level `router.use(protect)`.

### GET /api/push/key
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{ "success": true, "enabled": true, "publicKey": "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" }
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: `enabled` reflects whether the `VAPID_*` env vars are configured (`utils/push.js`); `publicKey` is `''`/undefined when not.

### POST /api/push/subscribe
- **Auth**: access token (`protect`)
- **Body** — the browser `PushSubscription`, either nested or at the top level (`req.body.subscription || req.body`):
  - `endpoint` (string, **required**)
  - `keys.p256dh` (string, **required**)
  - `keys.auth` (string, **required**)
  - (`User-Agent` request header is stored as `userAgent`)
- **Success response**: `201 { "success": true }`
- **Errors**:
  - `400 A valid push subscription is required.` (missing `endpoint`/`keys.p256dh`/`keys.auth`)
  - `400 Unsupported push endpoint.` (SSRF guard — host not on the known push-service allowlist, `isAllowedPushEndpoint`)
  - `429 Too many registered devices. Remove one and try again.` (already 20 subscriptions for this user and this endpoint is new)
- **Notes**: upsert keyed on `endpoint`, so re-subscribing the same device does not duplicate and reassigns the device to the current user.

### POST /api/push/unsubscribe
- **Auth**: access token (`protect`)
- **Body**: `endpoint` (string, optional) — deleted only when it belongs to the requesting user
- **Success response**: `200 { "success": true }`
- **Errors**: none — a missing/unknown `endpoint` still returns success

---

## Uploads & media access (`/api/upload`)

Router-level `router.use(protect)`.

### POST /api/upload
- **Auth**: access token (`protect`)
- **Body**: `multipart/form-data`, field name **`files`**, up to **10** files (`upload.array('files', 10)`)
  - Per-file limit **50 MB**; extension allowlist (anchored, case-insensitive): `.jpeg .jpg .png .gif .webp .mp4 .webm .mov .mp3 .wav .ogg .m4a .pdf .doc .docx .xls .xlsx .ppt .pptx .zip .txt`
- **Success response**: `201`

```json
{
  "success": true,
  "attachments": [
    { "name": "invoice.pdf", "size": 82311, "mime": "application/pdf", "url": "/uploads/invoice-1753790000000-123456789.pdf" },
    { "name": "shot.png", "size": 240118, "mime": "image/png", "url": "https://res.cloudinary.com/demo/image/upload/v1753790000/chatconnect/ab12cd34.png", "width": 1440, "height": 900 }
  ]
}
```

- **Errors**:
  - `400 No files uploaded.` (no `files` part)
  - `Unsupported file type.` — thrown by the multer `fileFilter`; it is a plain `Error`, so the central handler reports it as **`500`** (`"Something went wrong. Please try again."` in production)
  - multer `LIMIT_FILE_SIZE` / `LIMIT_UNEXPECTED_FILE` similarly surface as `500`
- **Notes**: `STORAGE_DRIVER` decides where bytes land (`utils/storage.js`): `local` (default) writes to `server/uploads` and returns the auth-gated `/uploads/<file>` path; `cloudinary` streams to the CDN (`folder: chatconnect`, `resource_type: auto`) and returns `secure_url` + `width`/`height`.

### GET /api/upload/access
- **Auth**: access token (`protect`)
- **Success response**: `200 { "success": true, "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…" }`
- **Errors**: none beyond shared `protect` errors
- **Notes**: mints a **scoped, 6-hour, media-only JWT** (`{ id, scope:'media' }`) that clients append as `?token=` to `<img>`/`<video>` src URLs, so the long-lived session JWT never enters URLs/history/referrers. `protect` explicitly rejects any token carrying a `scope`, so this token cannot be used as an API session. It is consumed by `GET /uploads/:filename` (`serveUpload`, mounted at the app root in `server.js:97`, **not** under `/api`), which additionally enforces chat membership for message attachments and the status audience for status media.

---

## API keys (`/api/keys`)

Router-level `router.use(protect, adminOnly)` — **platform admins only** (keys grant programmatic access to chats/messages/contacts).

### GET /api/keys
- **Auth**: access token (`protect`) + `adminOnly`
- **Success response**: `200`

```json
{
  "success": true,
  "availableScopes": ["chat:read", "chat:write", "contacts:read", "calls:write", "meetings:read", "meetings:write"],
  "keys": [
    {
      "id": "66a5e0f1a2b3c4d5e6f70801",
      "label": "CI bot",
      "prefix": "cc_live_ab12",
      "scopes": ["chat:read", "chat:write"],
      "active": true,
      "lastUsedAt": "2026-07-29T13:40:00.000Z",
      "createdAt": "2026-07-20T09:00:00.000Z"
    }
  ]
}
```

- **Errors**: `403 Admin access required.`
- **Notes**: scoped to `owner: req.user._id` — an admin sees only their own keys. The secret is never returned.

### POST /api/keys
- **Auth**: access token (`protect`) + `adminOnly`
- **Body**:
  - `label` (string, optional, default `"API key"`) — truncated to 80 chars
  - `scopes` (array of strings, **required**, non-empty) — subset of `chat:read`, `chat:write`, `contacts:read`, `calls:write`, `meetings:read`, `meetings:write`; de-duplicated
- **Success response**: `201`

```json
{
  "success": true,
  "message": "Store this key now — it will not be shown again.",
  "key": "cc_live_ab12Cd34Ef56Gh78Ij90Kl12Mn34Op",
  "id": "66a5e0f1a2b3c4d5e6f70801",
  "prefix": "cc_live_ab12",
  "scopes": ["chat:read", "chat:write"]
}
```

- **Errors**:
  - `403 Admin access required.`
  - `400 Choose at least one scope.` (non-array or empty)
  - `400 Unknown scope(s): <list>.`
  - `429 API key limit reached. Revoke an old key first.` (20 keys per owner)
- **Notes**: only the SHA-256 hash is stored (`hashedKey`, `select:false`); the plaintext is returned exactly once. Writes a `apikey.created` security-log event with `keyId` and `scopes`.

### DELETE /api/keys/:id
- **Auth**: access token (`protect`) + `adminOnly`
- **Path params**: `id` — ApiKey `_id`
- **Success response**: `200 { "success": true, "message": "API key revoked." }`
- **Errors**:
  - `403 Admin access required.`
  - `404 API key not found.` (unknown id or not owned by the requester)
- **Notes**: hard delete (`findOneAndDelete` scoped to `owner`). Writes an `apikey.revoked` security-log event.

---

## Live location (`/api/live-location`)

Router-level `router.use(protect)`.

### POST /api/live-location/start
- **Auth**: access token (`protect`)
- **Body**:
  - `chatId` (string ObjectId, **required**)
  - `lat` (number, **required**) — finite, `|lat| ≤ 90`
  - `lng` (number, **required**) — finite, `|lng| ≤ 180`
  - `durationSecs` (number, optional, default 3600) — clamped to `[60, 28800]` (8 h)
- **Success response**: `201`

```json
{
  "success": true,
  "message": {
    "_id": "66a6f102a3b4c5d6e7f80902",
    "chat": "66a0aaaabbbbccccddddeee1",
    "sender": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
    "type": "location",
    "location": { "lat": 28.6139, "lng": 77.209, "label": "Live location" },
    "liveLocation": { "active": true, "expiresAt": "2026-07-29T15:00:00.000Z" },
    "deliveredTo": ["66a1e0aabbccddee00110022"],
    "readBy": [{ "user": "66a1e0aabbccddee00110022", "at": "2026-07-29T14:00:00.000Z" }],
    "createdAt": "2026-07-29T14:00:00.000Z",
    "updatedAt": "2026-07-29T14:00:00.000Z"
  }
}
```

- **Errors**:
  - `400 Valid lat/lng are required.`
  - `404 Chat not found.`
  - `403 You are not a participant of this chat.`
- **Notes**: creates a real `location` message anchored in the chat and sets `chat.lastMessage`. Emits socket `receive-message` (`{ chatId, message }`) to **every** participant's personal room and `chat-updated` (`{ chatId }`) to everyone except the sharer.

### GET /api/live-location/:chatId/active
- **Auth**: access token (`protect`)
- **Path params**: `chatId` — Chat `_id`
- **Success response**: `200`

```json
{
  "success": true,
  "liveLocations": [
    {
      "_id": "66a6f102a3b4c5d6e7f80902",
      "sender": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
      "location": { "lat": 28.6139, "lng": 77.209, "label": "Live location" },
      "liveLocation": { "active": true, "expiresAt": "2026-07-29T15:00:00.000Z" }
    }
  ]
}
```

- **Errors**:
  - `404 Chat not found.`
  - `403 You are not a participant of this chat.`
- **Notes**: only shares with `liveLocation.active === true` **and** `expiresAt > now`.

### POST /api/live-location/:messageId/update
- **Auth**: access token (`protect`) + **sharer only**
- **Path params**: `messageId` — the live-location Message `_id`
- **Body**: `lat` (number, **required**), `lng` (number, **required**) — same range validation as `/start`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `400 Valid lat/lng are required.`
  - `404 Live location not found or already ended.` (unknown message, or `liveLocation.active` falsy)
  - `403 Only the sharer can update this location.`
  - `410 This live location has expired.` (also flips `active` to `false` as a side effect)
- **Notes**: high-frequency endpoint — emits the lightweight socket `live-location` event to the **chat room** (`{ chatId, messageId, userId, lat, lng }`) rather than the whole message.

### POST /api/live-location/:messageId/stop
- **Auth**: access token (`protect`) + **sharer only**
- **Path params**: `messageId` — the live-location Message `_id`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Live location not found.`
  - `403 Only the sharer can stop this location.`
- **Notes**: sets `liveLocation.active = false` and emits `live-location-stopped` (`{ chatId, messageId }`) to the chat room. No membership re-check beyond sender identity.

---

## Incoming webhooks (`/api/webhooks` management, `/api/hooks` ingress)

`webhookRoutes` (mounted at `/api/webhooks`) has `router.use(protect)`. `hookIngressRoutes` (mounted at `/api/hooks`) has **no** `protect` — the token in the URL *is* the credential.

### GET /api/webhooks
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "webhooks": [
    {
      "id": "66a7a1b2c3d4e5f6a7b8c901",
      "label": "CI alerts",
      "chatId": "66a0aaaabbbbccccddddeee1",
      "chatName": "Engineering",
      "url": "/api/hooks/Xk3n8QpR2vLmT7yZ0aBcD4eFgHiJkLmN",
      "active": true,
      "lastUsedAt": "2026-07-29T09:12:00.000Z",
      "createdAt": "2026-07-25T10:00:00.000Z"
    }
  ]
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: lists webhooks for **all group chats the requester belongs to** (not just ones they created), newest first. `url` includes the live secret token.

### POST /api/webhooks
- **Auth**: access token (`protect`) + **group membership**
- **Body**:
  - `chatId` (string ObjectId, **required**) — must be a group chat the requester is in
  - `label` (string, optional, default `"Webhook"`) — truncated to 60 chars; prefixed onto every posted message
- **Success response**: `201`

```json
{
  "success": true,
  "message": "Store this URL — anyone with it can post to the group.",
  "webhook": {
    "id": "66a7a1b2c3d4e5f6a7b8c901",
    "label": "CI alerts",
    "chatId": "66a0aaaabbbbccccddddeee1",
    "url": "/api/hooks/Xk3n8QpR2vLmT7yZ0aBcD4eFgHiJkLmN"
  }
}
```

- **Errors**:
  - `404 Chat not found.`
  - `400 Webhooks are only for group chats.`
  - `403 You are not a member of this group.`
- **Notes**: token is 24 random bytes base64url. `createdBy` becomes the attributed sender of all ingress messages. Writes a `webhook.created` security-log event.

### DELETE /api/webhooks/:id
- **Auth**: access token (`protect`) + **group membership**
- **Path params**: `id` — IncomingWebhook `_id`
- **Success response**: `200 { "success": true, "message": "Webhook revoked." }`
- **Errors**:
  - `404 Webhook not found.`
  - `404 Chat not found.` / `400 Webhooks are only for group chats.` / `403 You are not a member of this group.` (membership re-check on the hook's chat)
- **Notes**: any member of the group may revoke, not only the creator. Writes a `webhook.revoked` security-log event.

### POST /api/hooks/:token
- **Auth**: **none** — the unguessable `:token` path segment is the credential. Rate-limited by `webhookIngressLimiter`: **30 requests / min keyed on the token** (falls back to IP if absent).
- **Path params**: `token` — the webhook's secret token
- **Body**: accepts a JSON object, a raw string body, or a Slack-style payload:
  - `text` (string) — preferred
  - `content` (string) — accepted alias
  - a bare string body is accepted as the text
  - Resulting text is trimmed and truncated to **4000 chars**
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `404 Unknown webhook.` (bad token or `active:false`)
  - `400 A "text" field is required.` (empty after trim)
  - `404 The target chat no longer exists.`
  - `429 This webhook is receiving too many requests. Slow down.`
  - `403 Cross-site request blocked.` (browser request from a non-allowlisted origin — `csrfGuard` still applies)
- **Notes**: creates a `text` message in the group with content `"[<label>] <text>"`, attributed to `hook.createdBy`; updates `chat.lastMessage` and `hook.lastUsedAt`. Emits socket `receive-message` to every participant, plus `chat-updated` and a `group_message` notification + Web Push to everyone except `createdBy`.

---

## Agent tools — labels & quick replies (`/api/agent`)

Router-level `router.use(protect)`. "Manage" = `workspaceCan(user, WORKSPACE_SETTINGS)` → workspace `owner`/`admin`, or any platform admin (`utils/rbac.js`). Applying labels / reading is open to any workspace member.

### GET /api/agent/labels
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "labels": [
    { "_id": "66a8b1c2d3e4f5a6b7c8d901", "workspace": "66a0000000000000000000w1", "name": "New customer", "color": "#6366f1", "createdBy": "66a1e0aabbccddee00110022", "createdAt": "2026-07-20T10:00:00.000Z", "updatedAt": "2026-07-20T10:00:00.000Z" }
  ],
  "canManage": true
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: a user with no workspace gets `{ success: true, labels: [], canManage: false }`. Sorted `createdAt` asc.

### POST /api/agent/labels
- **Auth**: access token (`protect`) + workspace owner/admin
- **Body**:
  - `name` (string, **required**) — trimmed, truncated to 40 chars
  - `color` (string, optional, default `"#6366f1"`) — truncated to 20 chars
- **Success response**: `201 { "success": true, "label": { "...": "Label document" } }`
- **Errors**:
  - `400 You are not in a workspace.`
  - `403 Only workspace owners/admins can manage labels.`
  - `400 A label needs a name.`
  - `409 A label with that name already exists.` (unique `{workspace, name}` index)

### GET /api/agent/labels/chat/:chatId
- **Auth**: access token (`protect`) + **chat participant**
- **Path params**: `chatId` — Chat `_id`
- **Success response**: `200 { "success": true, "labels": [ { "...": "Label document" } ] }`
- **Errors**: `403 You are not a participant of this chat.` (also returned when the chat does not exist)
- **Notes**: intersects `chat.labels` with the requester's **own workspace's** labels, so another tenant's labels are never revealed.

### POST /api/agent/labels/:id/apply
- **Auth**: access token (`protect`) + **chat participant** (any workspace member — no manage permission needed)
- **Path params**: `id` — Label `_id` (must belong to the requester's workspace)
- **Body**:
  - `chatId` (string ObjectId, **required**)
  - `apply` (boolean, optional, default `true`) — pass `false` to remove the label
- **Success response**: `200 { "success": true, "applied": true }`
- **Errors**:
  - `404 Label not found.`
  - `403 You are not a participant of this chat.` (also when the chat does not exist)
- **Notes**: `$addToSet`/`$pull` on `Chat.labels`. No socket event.

### DELETE /api/agent/labels/:id
- **Auth**: access token (`protect`) + workspace owner/admin
- **Path params**: `id` — Label `_id`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `403 Only workspace owners/admins can manage labels.`
  - `404 Label not found.` (unknown id or another workspace's label)
- **Notes**: also `$pull`s the label id from every `Chat.labels` array.

### GET /api/agent/quick-replies
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "quickReplies": [
    { "_id": "66a8c1d2e3f4a5b6c7d8e901", "workspace": "66a0000000000000000000w1", "shortcut": "hours", "text": "We're open 9am–6pm IST, Mon–Fri.", "createdBy": "66a1e0aabbccddee00110022", "createdAt": "2026-07-21T08:00:00.000Z", "updatedAt": "2026-07-21T08:00:00.000Z" }
  ],
  "canManage": true
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: no workspace → `{ success: true, quickReplies: [], canManage: false }`. Sorted by `shortcut` asc.

### POST /api/agent/quick-replies
- **Auth**: access token (`protect`) + workspace owner/admin
- **Body**:
  - `shortcut` (string, **required**) — trimmed, leading `/` characters stripped, truncated to 40 chars
  - `text` (string, **required**) — truncated to 2000 chars
- **Success response**: `201 { "success": true, "quickReply": { "...": "QuickReply document" } }`
- **Errors**:
  - `400 You are not in a workspace.`
  - `403 Only workspace owners/admins can manage quick replies.`
  - `400 A quick reply needs a shortcut and text.`
  - `409 A quick reply with that shortcut already exists.`

### PATCH /api/agent/quick-replies/:id
- **Auth**: access token (`protect`) + workspace owner/admin
- **Path params**: `id` — QuickReply `_id`
- **Body**:
  - `shortcut` (string, optional) — applied only if a non-empty string; `/` prefix stripped, truncated to 40
  - `text` (string, optional) — applied only if a non-empty string after trim, truncated to 2000
- **Success response**: `200 { "success": true, "quickReply": { "...": "QuickReply document" } }`
- **Errors**:
  - `403 Only workspace owners/admins can manage quick replies.`
  - `404 Quick reply not found.`
  - `409 A quick reply with that shortcut already exists.`

### DELETE /api/agent/quick-replies/:id
- **Auth**: access token (`protect`) + workspace owner/admin
- **Path params**: `id` — QuickReply `_id`
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `403 Only workspace owners/admins can manage quick replies.`
  - `404 Quick reply not found.`

---

## Platform admin (`/api/admin`)

Router-level `router.use(protect, adminOnly)` — every endpoint requires `PERMISSIONS.PLATFORM_ADMIN` (`user.role === 'admin'`); otherwise `403 Admin access required.`

### GET /api/admin/stats
- **Auth**: access token (`protect`) + `adminOnly`
- **Success response**: `200`

```json
{
  "success": true,
  "stats": {
    "totalUsers": 1284,
    "activeUsers": 37,
    "totalGroups": 96,
    "totalMessages": 254913,
    "totalCalls": 4120,
    "openReports": 3,
    "userGrowth": [ { "_id": "2026-07-24", "count": 12 }, { "_id": "2026-07-25", "count": 9 } ],
    "messageVolume": [ { "_id": "2026-07-24", "count": 4210 }, { "_id": "2026-07-25", "count": 3880 } ]
  }
}
```

- **Errors**: `403 Admin access required.`
- **Notes**: `activeUsers` is the live socket presence count (`onlineUserIds().length`). `userGrowth`/`messageVolume` aggregate the last 7 days (from midnight 6 days ago), grouped by `%Y-%m-%d`.

### GET /api/admin/users
- **Auth**: access token (`protect`) + `adminOnly`
- **Query params**: `q` (string, optional) — case-insensitive **regex** match on `email`, `username`, or `name`; the input is regex-escaped (ReDoS/injection guard). Omitted → all users.
- **Success response**: `200`

```json
{
  "success": true,
  "users": [
    {
      "_id": "66a1e0aabbccddee00110022",
      "name": "Abhishek Singh",
      "username": "abhishek",
      "email": "abhisheksingh@capyngen.com",
      "phone": "+919900000000",
      "avatar": "",
      "bio": "",
      "role": "admin",
      "workspace": "66a0000000000000000000w1",
      "workspaceRole": "owner",
      "accountStatus": "active",
      "isOnline": true,
      "lastSeen": "2026-07-29T13:59:00.000Z",
      "createdAt": "2026-07-01T09:00:00.000Z",
      "updatedAt": "2026-07-29T13:59:00.000Z"
    }
  ]
}
```

- **Errors**: `403 Admin access required.`
- **Notes**: capped at 200, `createdAt` desc. Each user goes through `toSafeJSON()` — strips `password`, `otp`, `otpExpires`, `resetPasswordToken`, `resetPasswordExpires`, `twoStepPin`, `twoStepResetOtp`, `twoStepResetExpires`, `twoStepResetAttempts`.

### PATCH /api/admin/users/:id/status
- **Auth**: access token (`protect`) + `adminOnly`
- **Path params**: `id` — User `_id`
- **Body**: `accountStatus` (string, **required**) — `active` | `suspended` | `banned`
- **Success response**: `200 { "success": true, "user": { "...": "toSafeJSON() user" } }`
- **Errors**:
  - `403 Admin access required.`
  - `400 Invalid status.`
  - `400 You cannot suspend or ban your own account.` (self-target with a non-`active` status)
  - `404 User not found.`
- **Notes**: suspending/banning also `$inc`s `tokenVersion`, which invalidates every issued access token immediately (`protect` compares `tokenVersion`). Writes an `admin.user.status` security-log event.

### GET /api/admin/reports
- **Auth**: access token (`protect`) + `adminOnly`
- **Success response**: `200`

```json
{
  "success": true,
  "reports": [
    {
      "_id": "66a9d1e2f3a4b5c6d7e8f901",
      "reporter": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
      "targetType": "user",
      "targetUser": { "_id": "66a1e0aabbccddee00110044", "name": "Spammer", "username": "spammer", "avatar": "" },
      "targetChat": null,
      "targetMessage": null,
      "reason": "spam",
      "description": "Sending unsolicited links",
      "status": "open",
      "createdAt": "2026-07-28T10:00:00.000Z",
      "updatedAt": "2026-07-28T10:00:00.000Z"
    }
  ]
}
```

- **Errors**: `403 Admin access required.`
- **Notes**: capped at 200, `createdAt` desc.

### PATCH /api/admin/reports/:id
- **Auth**: access token (`protect`) + `adminOnly`
- **Path params**: `id` — Report `_id`
- **Body**: `status` (string, optional) — intended values `open` | `reviewing` | `resolved` | `dismissed`
- **Success response**: `200 { "success": true, "report": { "...": "Report document" } }`
- **Errors**:
  - `403 Admin access required.`
  - `404 Report not found.`
- **Notes**: uses `findByIdAndUpdate` **without** `runValidators`, so the `status` enum is *not* enforced here — any value (including `undefined`) is written as-is. Writes an `admin.report.update` security-log event.

---

## Broadcast lists (`/api/broadcasts`)

Router-level `router.use(protect)`. All list operations are scoped to `owner: req.user._id`.

Recipients are always filtered through `keepMutualContacts` — de-duplicated, self removed, kept only if in the owner's `contacts` **and** the owner is in theirs (WhatsApp's rule). Max **256** ids read from the body.

### GET /api/broadcasts
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "lists": [
    {
      "_id": "66aae1f2a3b4c5d6e7f80901",
      "name": "VIP customers",
      "recipients": [
        { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "isOnline": false }
      ],
      "recipientCount": 1,
      "createdAt": "2026-07-22T10:00:00.000Z"
    }
  ]
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: sorted `updatedAt` desc; `recipients` populated with `name username avatar isOnline`.

### POST /api/broadcasts
- **Auth**: access token (`protect`)
- **Body**:
  - `name` (string, **required**) — trimmed, truncated to 80 chars
  - `recipients` (array of user ObjectIds, optional) — first 256 entries, then mutual-contact filtered
- **Success response**: `201 { "success": true, "list": { "_id": "…", "name": "VIP customers", "recipients": [ … ], "recipientCount": 1, "createdAt": "…" } }`
- **Errors**: `400 A broadcast list needs a name.`
- **Notes**: non-mutual ids are silently dropped, so `recipientCount` can be smaller than what was submitted.

### POST /api/broadcasts/:id/send
- **Auth**: access token (`protect`) + **list owner**
- **Path params**: `id` — BroadcastList `_id`
- **Body**:
  - `content` (string, optional) — ignored unless a string
  - `type` (string, optional, default `"text"`) — one of `text`, `image`, `video`, `document`; anything else falls back to `text`
  - `attachments` (array, optional) — each must have a string `url` starting with `/uploads/` or `https://`; first 20 kept
  - At least one of `content` / `attachments` must be non-empty
- **Success response**: `200 { "success": true, "sent": 12, "skipped": 2 }`
- **Errors**:
  - `404 Broadcast list not found.`
  - `400 Broadcast message cannot be empty.`
- **Notes**: recipients are **re-validated at send time** (a contact may have been removed since), which is what `skipped` counts. For each recipient it get-or-creates the 1:1 chat (`workspace: null`), creates a separate `Message` (pre-marked delivered/read for the sender), updates `chat.lastMessage`, and emits socket `receive-message` + `chat-updated` to the recipient and `chat-updated` to the sender. Recipients never see each other. No push notification is sent for broadcast messages.

### PATCH /api/broadcasts/:id
- **Auth**: access token (`protect`) + **list owner**
- **Path params**: `id` — BroadcastList `_id`
- **Body**:
  - `name` (string, optional) — applied only if a non-empty trimmed string; truncated to 80
  - `recipients` (array, optional) — if an array, **replaces** the list (first 256, mutual-contact filtered)
- **Success response**: `200 { "success": true, "list": { "...": "same shape as POST" } }`
- **Errors**: `404 Broadcast list not found.`

### DELETE /api/broadcasts/:id
- **Auth**: access token (`protect`) + **list owner**
- **Path params**: `id` — BroadcastList `_id`
- **Success response**: `200 { "success": true }`
- **Errors**: `404 Broadcast list not found.`

---

## Business catalog (`/api/catalog`)

Router-level `router.use(protect)`. Editing requires `workspaceCan(user, WORKSPACE_SETTINGS)` (workspace owner/admin, or platform admin).

Route order matters: `/mine` is declared before the greedy `GET /:workspaceId`.

`publicProduct` shape: `{ _id, workspace, name, description, price, currency, images, link, inStock, createdAt }`.

### GET /api/catalog/mine
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "products": [
    { "_id": "66ab01f2a3b4c5d6e7f80901", "workspace": "66a0000000000000000000w1", "name": "Blue kurta", "description": "Cotton, hand-block print", "price": 1499, "currency": "INR", "images": ["/uploads/kurta-1753790000000-1.jpg"], "link": "https://shop.example.com/kurta", "inStock": true, "createdAt": "2026-07-23T10:00:00.000Z" }
  ],
  "canManage": true
}
```

- **Errors**: none beyond shared `protect` errors
- **Notes**: no workspace → `{ success: true, products: [], canManage: false }`. Catalogs are Redis-cached per workspace for 120 s (`catalog:<workspaceId>`; no-op without `REDIS_URL`), invalidated on every write below.

### GET /api/catalog/:workspaceId
- **Auth**: access token (`protect`) — **any signed-in user may browse any business's catalog**
- **Path params**: `workspaceId` — Workspace `_id`
- **Success response**: `200`

```json
{
  "success": true,
  "business": {
    "_id": "66a0000000000000000000w1",
    "name": "Capyngen Store",
    "businessProfile": { "category": "Retail", "description": "Handmade clothing", "hours": "9–6 Mon–Fri", "address": "Bengaluru", "website": "https://example.com", "email": "hello@example.com" }
  },
  "products": [ { "...": "publicProduct" } ]
}
```

- **Errors**: `404 Business not found.`
- **Notes**: declared last in the router because the param is greedy.

### POST /api/catalog
- **Auth**: access token (`protect`) + workspace owner/admin
- **Body**:
  - `name` (string, **required**) — trimmed, truncated to 120
  - `description` (string, optional) — truncated to 2000
  - `price` (number, optional, default 0) — coerced, floored at 0
  - `currency` (string, optional, default `"USD"`) — truncated to 8
  - `images` (array of strings, optional) — each must start with `/uploads/` or `https://`; first 10 kept
  - `link` (string, optional) — truncated to 500
  - `inStock` (boolean, optional, default `true` — only an explicit `false` sets it false)
- **Success response**: `201 { "success": true, "product": { "...": "publicProduct" } }`
- **Errors**:
  - `400 You are not in a workspace.`
  - `403 Only workspace owners/admins can edit the catalog.`
  - `400 A product needs a name.`
- **Notes**: invalidates the workspace's catalog cache.

### POST /api/catalog/:id/share
- **Auth**: access token (`protect`) + **chat participant** (no catalog-manage permission needed; **any** product id may be shared, including another business's)
- **Path params**: `id` — Product `_id`
- **Body**: `chatId` (string ObjectId, **required**)
- **Success response**: `201`

```json
{
  "success": true,
  "message": {
    "_id": "66ab1102a3b4c5d6e7f80902",
    "chat": "66a0aaaabbbbccccddddeee1",
    "sender": { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek", "username": "abhishek", "avatar": "" },
    "type": "product",
    "content": "Blue kurta — INR 1499",
    "product": {
      "ref": "66ab01f2a3b4c5d6e7f80901",
      "name": "Blue kurta",
      "description": "Cotton, hand-block print",
      "price": 1499,
      "currency": "INR",
      "image": "/uploads/kurta-1753790000000-1.jpg",
      "link": "https://shop.example.com/kurta"
    },
    "deliveredTo": ["66a1e0aabbccddee00110022"],
    "readBy": [{ "user": "66a1e0aabbccddee00110022", "at": "2026-07-29T14:30:00.000Z" }],
    "createdAt": "2026-07-29T14:30:00.000Z",
    "updatedAt": "2026-07-29T14:30:00.000Z"
  }
}
```

- **Errors**:
  - `404 Product not found.`
  - `404 Chat not found.`
  - `403 You are not a participant of this chat.`
- **Notes**: creates a `product`-type message with the product **snapshotted** onto it, plus a plain-text `content` fallback. Honours the chat's disappearing timer (`expiresAt = now + chat.disappearingSeconds`). Emits socket `receive-message` to every participant and `chat-updated` to everyone but the sender. Updates `chat.lastMessage`.

### PATCH /api/catalog/:id
- **Auth**: access token (`protect`) + workspace owner/admin
- **Path params**: `id` — Product `_id` (must be in the requester's workspace)
- **Body** (all optional):
  - `name` (string) — applied only if non-empty after trim; truncated 120
  - `description` (string) — truncated 2000
  - `price` (number) — coerced, floored at 0
  - `currency` (string) — truncated 8
  - `link` (string) — truncated 500
  - `inStock` (boolean) — coerced with `Boolean()`
  - `images` (array of strings) — replaces the array; same `/uploads/` or `https://` filter, first 10
- **Success response**: `200 { "success": true, "product": { "...": "publicProduct" } }`
- **Errors**:
  - `403 Only workspace owners/admins can edit the catalog.`
  - `404 Product not found.`
- **Notes**: invalidates the catalog cache.

### DELETE /api/catalog/:id
- **Auth**: access token (`protect`) + workspace owner/admin
- **Path params**: `id` — Product `_id` (must be in the requester's workspace)
- **Success response**: `200 { "success": true }`
- **Errors**:
  - `403 Only workspace owners/admins can edit the catalog.`
  - `404 Product not found.`
- **Notes**: invalidates the catalog cache.

---

## Communities (`/api/communities`)

Router-level `router.use(protect)`. Community roles are per-community (`members[].role`: `admin` | `member`) and independent of workspace/platform roles.

`publicCommunity` shape: `{ _id, name, description, avatar, workspace, announcementGroup, memberCount, groupCount, isAdmin }` — plus `inviteCode` **only for community admins**.

### POST /api/communities
- **Auth**: access token (`protect`)
- **Body**:
  - `name` (string, **required**) — trimmed; max 80 (schema)
  - `description` (string, optional) — truncated to 500
- **Success response**: `201`

```json
{
  "success": true,
  "community": {
    "_id": "66ac2102a3b4c5d6e7f80901",
    "name": "Bangalore Devs",
    "description": "Meetups and jobs",
    "avatar": "",
    "workspace": "66a0000000000000000000w1",
    "announcementGroup": "66ac2103a3b4c5d6e7f80902",
    "memberCount": 1,
    "groupCount": 1,
    "isAdmin": true,
    "inviteCode": "Zk3nQpR2vLmT"
  }
}
```

- **Errors**: `400 A community needs a name.`
- **Notes**: side effect — also creates an **Announcements** group chat (`"<name> Announcements"`, `messagingPolicy:'admins'`, creator as `owner`) which becomes `announcementGroup` and the first entry in `groups`. `workspace` is the creator's workspace or `null`. `inviteCode` is generated by a pre-save hook (9 random bytes base64url).

### GET /api/communities
- **Auth**: access token (`protect`)
- **Success response**: `200 { "success": true, "communities": [ { "...": "publicCommunity" } ] }`
- **Errors**: none beyond shared `protect` errors
- **Notes**: only communities where the requester is a member, `updatedAt` desc.

### POST /api/communities/join/:inviteCode
- **Auth**: access token (`protect`)
- **Path params**: `inviteCode` — the community's invite code
- **Body**: none read
- **Success response**: `200 { "success": true, "community": { "...": "publicCommunity" } }`
- **Errors**: `404 That community invite is invalid.`
- **Notes**: idempotent — already-members just get the community back. On a fresh join, pushes `{ user, role:'member' }` and adds the user to the announcement group chat as a `member`. No socket event. Note the response is computed **before** the membership push is reflected in `publicCommunity`, so a first-time joiner sees `isAdmin:false` and the pre-join `memberCount`.

### GET /api/communities/:id
- **Auth**: access token (`protect`) + **community member**
- **Path params**: `id` — Community `_id`
- **Success response**: `200`

```json
{
  "success": true,
  "community": {
    "_id": "66ac2102a3b4c5d6e7f80901",
    "name": "Bangalore Devs",
    "description": "Meetups and jobs",
    "avatar": "",
    "workspace": "66a0000000000000000000w1",
    "announcementGroup": "66ac2103a3b4c5d6e7f80902",
    "memberCount": 42,
    "groupCount": 3,
    "isAdmin": false,
    "groups": [
      { "_id": "66ac2103a3b4c5d6e7f80902", "name": "Bangalore Devs Announcements", "avatar": "", "isAnnouncement": true, "memberCount": 42 },
      { "_id": "66ac2204a3b4c5d6e7f80903", "name": "Jobs", "avatar": "", "isAnnouncement": false, "memberCount": 18 }
    ]
  }
}
```

- **Errors**:
  - `404 Community not found.`
  - `403 You are not a member of this community.`

### POST /api/communities/:id/groups
- **Auth**: access token (`protect`) + **community admin**
- **Path params**: `id` — Community `_id`
- **Body**: `name` (string, **required**) — trimmed group name
- **Success response**: `201 { "success": true, "chat": { "_id": "66ac2204a3b4c5d6e7f80903", "name": "Jobs" } }`
- **Errors**:
  - `404 Community not found.`
  - `403 Only community admins can add groups.`
  - `400 Group name is required.`
- **Notes**: creates a new group `Chat` with **only the requester** as `owner` (existing community members are not auto-added) and links it into `community.groups`.

### POST /api/communities/:id/leave
- **Auth**: access token (`protect`)
- **Path params**: `id` — Community `_id`
- **Body**: none read
- **Success response**: `200 { "success": true }`
- **Errors**: `404 Community not found.`
- **Notes**: filters the requester out of `members` and `$pull`s them from the announcement group's participants. No membership pre-check (a non-member's leave is a harmless no-op) and no admin/last-admin protection.

---

## Reports (`/api/reports`)

Router-level `router.use(protect)`.

### POST /api/reports
- **Auth**: access token (`protect`)
- **Body**:
  - `targetType` (string, **required**) — `user` | `group` | `message` | `status` (Mongoose enum)
  - `reason` (string, **required**) — max 120 (schema)
  - `targetUser` (string ObjectId, optional)
  - `targetChat` (string ObjectId, optional)
  - `targetMessage` (string ObjectId, optional)
  - `description` (string, optional) — max 2000 (schema)
- **Success response**: `201`

```json
{
  "success": true,
  "report": {
    "_id": "66a9d1e2f3a4b5c6d7e8f901",
    "reporter": "66a1e0aabbccddee00110022",
    "targetType": "user",
    "targetUser": "66a1e0aabbccddee00110044",
    "reason": "spam",
    "description": "Sending unsolicited links",
    "status": "open",
    "createdAt": "2026-07-29T15:00:00.000Z",
    "updatedAt": "2026-07-29T15:00:00.000Z"
  }
}
```

- **Errors**:
  - `400 Target type and reason are required.`
  - `400` from Mongoose validation (invalid `targetType` enum, over-length `reason`/`description`)
- **Notes**: no verification that the target exists or that the reporter can see it. Reports surface to admins via `GET /api/admin/reports`. No notification/socket side effects.

---

## Workspaces (`/api/workspaces`)

Router-level `router.use(protect)`. One workspace per user (`user.workspace`), so every route targets `/me` — the requester's own workspace. Permission checks come from `utils/rbac.js`:

- `MEMBERS_MANAGE` (owner + admin) → member role/status/removal
- `WORKSPACE_SETTINGS` (owner + admin) → `PATCH /me`
- `WORKSPACE_INVITE` (owner + admin) → invite rotation
- `WORKSPACE_TRANSFER` (**owner only**) → ownership transfer
- a platform admin (`role:'admin'`) satisfies all of the above

### GET /api/workspaces/me
- **Auth**: access token (`protect`)
- **Success response**: `200`

```json
{
  "success": true,
  "workspace": {
    "_id": "66a0000000000000000000w1",
    "name": "Capyngen",
    "slug": "capyngen",
    "type": "team",
    "plan": "free",
    "owner": "66a1e0aabbccddee00110022",
    "businessProfile": { "category": "Software", "description": "", "hours": "", "address": "", "website": "", "email": "" },
    "createdAt": "2026-07-01T09:00:00.000Z",
    "inviteCode": "Ab12Cd34",
    "inviteLink": "https://app.example.com/signup?invite=Ab12Cd34",
    "autoReplies": { "greeting": { "enabled": true, "text": "Hi! We'll reply shortly." }, "away": { "enabled": false, "text": "", "startHour": 19, "endHour": 9 } }
  },
  "myRole": "owner",
  "members": [
    { "_id": "66a1e0aabbccddee00110022", "name": "Abhishek Singh", "username": "abhishek", "avatar": "", "isOnline": true, "lastSeen": "2026-07-29T13:59:00.000Z", "workspaceRole": "owner", "accountStatus": "active", "createdAt": "2026-07-01T09:00:00.000Z" }
  ],
  "memberCount": 1
}
```

- **Errors**: `404 You are not in a workspace yet.`
- **Notes**: `inviteCode`, `inviteLink` and `autoReplies` are included **only** for managers of a non-personal workspace. For the shared **personal** workspace (`type:'personal'`) the member roster is deliberately empty and `memberCount` is `undefined` (omitted from JSON) — it would otherwise leak a browsable directory of every personal user. Member fields: `name username avatar isOnline lastSeen workspaceRole accountStatus createdAt`, sorted `createdAt` asc.

### PATCH /api/workspaces/me
- **Auth**: access token (`protect`) + `WORKSPACE_SETTINGS` (owner/admin)
- **Body**:
  - `name` (string, optional) — applied only if non-empty after trim; truncated to 80
  - `businessProfile` (object, optional) — only these string fields are read, each truncated to 1000: `category`, `description`, `hours`, `address`, `website`, `email`. **`verified` can never be self-set.**
  - `autoReplies` (object, optional):
    - `greeting.enabled` (boolean), `greeting.text` (string, ≤1000)
    - `away.enabled` (boolean), `away.text` (string, ≤1000), `away.startHour` (number, clamped 0–23), `away.endHour` (number, clamped 0–23)
- **Success response**: `200 { "success": true, "workspace": { "...": "publicWorkspace with inviteCode/inviteLink/autoReplies" } }`
- **Errors**:
  - `403 Only workspace owners/admins can change settings.`
  - `404 No workspace.`
- **Notes**: `autoReplies` drives the WhatsApp-Business greeting/away auto-responder consumed by the `automsg.maybe` queue job on inbound 1:1 messages.

### POST /api/workspaces/me/invite/rotate
- **Auth**: access token (`protect`) + `WORKSPACE_INVITE` (owner/admin)
- **Body**: none read
- **Success response**: `200 { "success": true, "workspace": { "...": "publicWorkspace with the NEW inviteCode/inviteLink" } }`
- **Errors**:
  - `403 Only workspace owners/admins can rotate the invite.`
  - `404 No workspace.`
- **Notes**: retries up to 5 times on a duplicate-code collision. Invalidates the previous invite link immediately.

### POST /api/workspaces/me/transfer
- **Auth**: access token (`protect`) + `WORKSPACE_TRANSFER` (**owner only**, or platform admin)
- **Body**: `userId` (string ObjectId, **required**) — the member receiving ownership
- **Success response**: `200 { "success": true, "message": "Ownership transferred to Priya." }`
- **Errors**:
  - `403 Only the workspace owner can transfer ownership.`
  - `400 Choose another member to transfer ownership to.` (missing `userId`, or self)
  - `404 Member not found in this workspace.`
  - `400 That member is not active.`
- **Notes**: target becomes `workspaceRole:'owner'`, the caller steps down to `admin`, and `Workspace.owner` is repointed. Saves bypass validation (`validateBeforeSave:false`). No session revocation.

### PATCH /api/workspaces/me/members/:userId/role
- **Auth**: access token (`protect`) + `MEMBERS_MANAGE` (owner/admin)
- **Path params**: `userId` — target User `_id` (must be in the same workspace)
- **Body**: `role` (string, **required**) — `admin` | `member`
- **Success response**: `200 { "success": true, "member": { "_id": "66a1e0aabbccddee00110033", "workspaceRole": "admin" } }`
- **Errors**:
  - `403 Only workspace owners/admins can change roles.`
  - `400 Role must be admin or member.`
  - `404 Member not found in this workspace.`
  - `400 The owner's role can't be changed.`

### PATCH /api/workspaces/me/members/:userId/status
- **Auth**: access token (`protect`) + `MEMBERS_MANAGE` (owner/admin)
- **Path params**: `userId` — target User `_id` (must be in the same workspace)
- **Body**: `status` (string, **required**) — `active` | `suspended`
- **Success response**: `200 { "success": true, "member": { "_id": "66a1e0aabbccddee00110033", "accountStatus": "suspended" } }`
- **Errors**:
  - `403 Only workspace owners/admins can change member access.`
  - `400 Status must be active or suspended.`
  - `400 You can't change your own access here.`
  - `404 Member not found in this workspace.`
  - `400 The workspace owner can't be paused.`
  - `403 This account is banned at the platform level.` (a platform ban outranks a workspace owner and can't be lifted here)
- **Notes**: suspending bumps `tokenVersion`, killing all live sessions immediately.

### DELETE /api/workspaces/me/members/:userId
- **Auth**: access token (`protect`) + `MEMBERS_MANAGE` (owner/admin)
- **Path params**: `userId` — target User `_id` (must be in the same workspace)
- **Success response**: `200 { "success": true, "message": "Member removed from the workspace." }`
- **Errors**:
  - `403 Only workspace owners/admins can remove members.`
  - `400 You can't remove yourself. Transfer ownership or delete your account instead.`
  - `404 Member not found in this workspace.`
  - `400 The workspace owner can't be removed.`
- **Notes**: destructive, multi-step eject — (1) `$pull`s the member from **every** chat owned by this workspace, group *and* 1:1, since chat access is membership-based; (2) removes them from other members' `contacts`/`favorites`/`blockedUsers` and clears their own `contacts`/`favorites`; (3) creates a fresh personal workspace for them (`createWorkspaceForUser`); (4) `$inc`s `tokenVersion`, forcing a re-login. Cross-workspace DMs (`workspace: null`) are untouched by design.

---

## Public API v1 (`/api/v1`)

**This is the public/partner API.** It authenticates *entirely differently* from every other router above: there is **no `protect`, no cookie, and no JWT**. Instead each route uses `apiKeyAuth([...scopes])` (`middleware/apiKey.js`):

- Credential: **`X-API-Key: cc_live_…`** request header (nothing else is accepted — no query param, no bearer form).
- Lookup: SHA-256 hash of the presented key against `ApiKey.hashedKey` with `active: true`; the owner is populated.
- **The key acts *as* its owner**: `req.user = key.owner`, so the exact same already-secured controllers used by the app run unchanged — a key can never reach data its owner couldn't.
- Each route declares the scopes it requires; **all** must be present on the key.
- Side effect: `ApiKey.lastUsedAt` is stamped best-effort on every authenticated call.
- **Rate limit**: router-level `apiV1Limiter` — **120 requests/min keyed on the `X-API-Key` header** (falls back to IP if absent), *in addition to* the global `apiLimiter`. Exceeded → `429 {"success":false,"message":"API rate limit exceeded (120/min). Slow down."}`
- `csrfGuard` still applies to mutations, but non-browser clients send no `Origin` and pass through.
- Keys are minted by a **platform admin** via `POST /api/keys` (see [API keys](#api-keys-apikeys)).

**Shared `apiKeyAuth` errors** (apply to every v1 endpoint; not repeated below):

| Status | Message |
|---|---|
| 401 | `API key required (X-API-Key header).` |
| 401 | `Invalid or revoked API key.` (no hash match, `active:false`, or missing owner) |
| 403 | `The key owner account is not active.` (owner suspended/banned) |
| 403 | `This API key is missing the required scope: <scope>.` |

Valid scopes: `chat:read`, `chat:write`, `contacts:read`, `calls:write`, `meetings:read`, `meetings:write`.

### GET /api/v1/me
- **Auth**: apiKey (`apiKeyAuth()`) — **no scope required**, any valid key works
- **Success response**: `200`

```json
{
  "success": true,
  "user": {
    "_id": "66a1e0aabbccddee00110022",
    "name": "Abhishek Singh",
    "username": "abhishek",
    "email": "abhisheksingh@capyngen.com",
    "avatar": "",
    "role": "admin",
    "workspace": "66a0000000000000000000w1",
    "workspaceRole": "owner",
    "accountStatus": "active",
    "createdAt": "2026-07-01T09:00:00.000Z"
  },
  "scopes": ["chat:read", "chat:write"]
}
```

- **Errors**: shared `apiKeyAuth` errors only
- **Notes**: identity/health check for a key. `user` is `toSafeJSON()` (all secret/OTP/PIN fields stripped). Handler is inline in `routes/v1Routes.js`, not a controller.

### GET /api/v1/contacts
- **Auth**: apiKey — scope **`contacts:read`**
- **Query params**: none
- **Success response**: `200`

```json
{
  "success": true,
  "contacts": [
    { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "email": "priya@capyngen.com", "phone": "+919900000001", "avatar": "", "bio": "", "isOnline": false, "lastSeen": "2026-07-29T09:00:00.000Z", "accountStatus": "active", "createdAt": "2026-07-05T09:00:00.000Z" }
  ],
  "favorites": []
}
```

- **Errors**: shared `apiKeyAuth` errors only
- **Notes**: delegates to `getContacts` (`controllers/userController.js`) — the key owner's own contact + favorites lists.

### GET /api/v1/users/search
- **Auth**: apiKey — scope **`contacts:read`**
- **Query params**: `q` (string, optional) — empty/absent returns `{ success: true, users: [] }`
- **Success response**: `200 { "success": true, "users": [ { "_id": "…", "name": "Priya", "username": "priya", "email": "priya@capyngen.com", "phone": "+919900000001", "avatar": "", "bio": "", "isOnline": false, "lastSeen": "…", "accountStatus": "active", "createdAt": "…" } ] }`
- **Errors**: shared `apiKeyAuth` errors only
- **Notes**: delegates to `searchUsers`. Global reachability by **exact** `email`/`username`/normalized `phone`; **partial** regex matching on `email`/`username`/`name` only inside the owner's own non-personal workspace (so there is no browsable global directory). Excludes the owner and anyone they've blocked, max 20 results, and presence fields are stripped per each result's privacy settings (`applyPresencePrivacy`).

### GET /api/v1/chats
- **Auth**: apiKey — scope **`chat:read`**
- **Query params**: none
- **Success response**: `200`

```json
{
  "success": true,
  "chats": [
    {
      "_id": "66a0aaaabbbbccccddddeee1",
      "isGroup": false,
      "workspace": "66a0000000000000000000w1",
      "participants": [
        { "user": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "", "bio": "", "isOnline": false, "lastSeen": "2026-07-29T09:00:00.000Z" } }
      ],
      "lastMessage": { "_id": "66a0f00100000000000000a1", "content": "See you at 5", "type": "text", "sender": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "" }, "createdAt": "2026-07-29T12:00:00.000Z" },
      "disappearingSeconds": 0,
      "updatedAt": "2026-07-29T12:00:00.000Z",
      "unreadCount": 2,
      "pinned": false,
      "archived": false,
      "muted": false
    }
  ]
}
```

- **Errors**: shared `apiKeyAuth` errors only
- **Notes**: delegates to `getChats`. **Chats the owner has locked behind their two-step PIN are excluded** (they surface only via the app's `POST /api/chats/locked`, which is not exposed on v1). Read-through Redis cache per user; `unreadCount` comes from a single aggregation.

### POST /api/v1/chats/direct/:userId
- **Auth**: apiKey — scope **`chat:write`**
- **Path params**: `userId` — the other user's `_id`
- **Body**: none read
- **Success response**: `200 { "success": true, "chat": { "...": "populated chat, same shape as a GET /api/v1/chats item without unreadCount/pinned/archived/muted" } }`
- **Errors**:
  - `400 You can't chat with yourself.`
  - `404 User not found.`
  - `403 Send a contact request and get accepted before you can chat.` (creating a **new** chat requires a **mutual** contact relationship; an existing chat is returned regardless)
- **Notes**: get-or-create. A new cross-workspace DM is created with `workspace: null` so it is never swept by workspace member-removal; a same-workspace DM keeps the workspace tag. Invalidates both parties' chat-list caches.

### GET /api/v1/messages/:chatId
- **Auth**: apiKey — scope **`chat:read`**
- **Path params**: `chatId` — Chat `_id`
- **Query params**:
  - `limit` (number, default 40, max 100)
  - `before` (date string, optional) — cursor; returns messages with `createdAt < before`
- **Success response**: `200`

```json
{
  "success": true,
  "messages": [
    {
      "_id": "66a0f00100000000000000a1",
      "chat": "66a0aaaabbbbccccddddeee1",
      "sender": { "_id": "66a1e0aabbccddee00110033", "name": "Priya", "username": "priya", "avatar": "" },
      "type": "text",
      "content": "See you at 5",
      "attachments": [],
      "reactions": [],
      "replyTo": null,
      "isEdited": false,
      "isDeleted": false,
      "readBy": [{ "user": "66a1e0aabbccddee00110033", "at": "2026-07-29T12:00:00.000Z" }],
      "createdAt": "2026-07-29T12:00:00.000Z",
      "updatedAt": "2026-07-29T12:00:00.000Z"
    }
  ]
}
```

- **Errors**:
  - `404 Chat not found.`
  - `403 You are not a participant of this chat.`
- **Notes**: returned **oldest-first** (fetched desc, then reversed). Messages the owner deleted for themselves are excluded.

### POST /api/v1/messages
- **Auth**: apiKey — scope **`chat:write`**
- **Body**:
  - `chatId` (string ObjectId, **required**)
  - `content` (string, optional, default `""`) — max 10 000 chars
  - `type` (string, optional, default `"text"`) — one of `text`, `image`, `video`, `audio`, `voice`, `document`, `location` (`system` is server-only)
  - `attachments` (array, optional) — max 20; each needs a string `url` starting with `/uploads/` or `https://`; only `url`, `name`, `size`, `mime`, `width`, `height`, `duration` are kept
  - `location` (object, optional) — `{ lat, lng, label }`
  - `replyTo` (string ObjectId, optional)
  - `mentions` (array of user ObjectIds, optional) — first 100
  - `forwardedFrom` (optional)
  - `viewOnce` (boolean, optional) — honoured only for `image`/`video`
  - At least one of `content` / `attachments` / `location` must be present
- **Success response**: `201 { "success": true, "message": { "...": "populated message, same shape as GET /api/v1/messages/:chatId item" } }`
- **Errors**:
  - `404 Chat not found.`
  - `403 You are not a participant of this chat.`
  - `403 Only admins can send messages in this group.` (group with `messagingPolicy:'admins'` and the owner is not a group owner/admin)
  - `400 Invalid message type.`
  - `400 Message text must be a string under 10000 characters.`
  - `400 attachments must be a list.`
  - `400 At most 20 attachments per message.`
  - `400 Message cannot be empty.`
- **Notes**: full app-equivalent side effects — sets `chat.lastMessage`, stamps `expiresAt` when the chat has a disappearing timer, invalidates every participant's chat-list cache, emits socket `receive-message` to all participants and `chat-updated` + a `message`/`group_message` notification with Web Push to everyone but the sender, and enqueues `automsg.maybe` for 1:1 chats (business greeting/away auto-reply).

### POST /api/v1/calls
- **Auth**: apiKey — scope **`calls:write`**
- **Body**: identical to [`POST /api/calls`](#post-apicalls) — `type` (`audio`|`video`, default `audio`), `chatId`, `participants` (array), `isGroup` (boolean)
- **Success response**: `201 { "success": true, "call": { "...": "Call document, status 'ringing'" } }`
- **Errors**:
  - `400 participants must be a list.`
  - `403 You are not a member of this group.`
  - `403 No reachable participants for this call.`
- **Notes**: same reachability filter (group membership, or mutual contacts) and the same `call:incoming` socket emit + `incoming_call` notification/Web Push per allowed target.

### GET /api/v1/meetings
- **Auth**: apiKey — scope **`meetings:read`**
- **Query params**: none
- **Success response**: `200` — identical to [`GET /api/meetings`](#get-apimeetings)
- **Errors**: shared `apiKeyAuth` errors only
- **Notes**: the detailed `attendees` array is still stripped unless the key owner is the meeting's host.

### POST /api/v1/meetings
- **Auth**: apiKey — scope **`meetings:write`**
- **Body**: identical to [`POST /api/meetings`](#post-apimeetings) — `title`, `description`, `startAt` (omit → instant meeting), `durationMinutes`, `timezone`, `type`, `participants`, `recurrence`, `reminderMinutes`, `chatId`, `inviteEmails`, `settings`
- **Success response**: `201 { "success": true, "meeting": { "...": "populated meeting" } }`
- **Errors**:
  - `400 participants must be a list.`
  - `400 inviteEmails must be a list.`
  - `500 Could not allocate a meeting room. Please retry.`
- **Notes**: the key owner becomes the meeting `host`; pre-invites are restricted to the owner's workspace. Same `meeting-invited` socket emit, notifications, and `.ics` email invitations as the app endpoint.
agentId: ac2c03844581587da (use SendMessage with to: 'ac2c03844581587da', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 154788
tool_uses: 72
duration_ms: 532254</usage>
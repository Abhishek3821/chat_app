# Environment Variables

Every variable the app actually reads, where it is read, and what happens when it is missing.
Compiled by grepping all `process.env.` / `import.meta.env.` references in `server/` and `client/`.

> **No secret values appear in this document.** Secrets are listed by *name* only.

## 2.0 Secrets policy

### 🔴 Secrets — never commit, never log, rotate if exposed
`MONGO_URI` (embeds the Atlas password) · `JWT_SECRET` · `SUPER_ADMIN_PASSWORD` (the platform admin's login) · `EMAIL_PASS` / `SMTP_PASS` · `BREVO_API_KEY` · `CLOUDINARY_URL` (embeds the API secret) · `CLOUDINARY_API_SECRET` · `CLOUDINARY_API_KEY` · `VAPID_PRIVATE_KEY` · `LIVEKIT_API_SECRET` · `LIVEKIT_API_KEY` · `TWILIO_AUTH_TOKEN` · `TWILIO_ACCOUNT_SID` · `REDIS_URL` (usually embeds a password) · `SEED_CONFIRM` (not secret, but destructive)

### 🟡 Public-by-construction — safe in the bundle, but still access-controlled resources
Every `VITE_*` var is **baked into the client JS at build time and is world-readable**. `client/.env.example` states this explicitly. `VITE_TURN_CREDENTIAL` is therefore *exposed by design* — prefer short-lived TURN credentials (`VITE_TURN_CREDENTIALS_URL`). **Never** put a real secret behind a `VITE_` prefix.

### 🟢 Non-secret configuration
`PORT` · `NODE_ENV` · `CLIENT_URL` · `JWT_ACCESS_EXPIRES` · `REFRESH_TOKEN_DAYS` · `SESSION_IDLE_DAYS` · `EMAIL_HOST` · `EMAIL_PORT` · `EMAIL_USER` · `EMAIL_FROM` · `STORAGE_DRIVER` · `CLOUDINARY_CLOUD_NAME` · `VAPID_PUBLIC_KEY` · `VAPID_SUBJECT` · `LIVEKIT_URL` · `DNS_SERVERS` · `EXTRA_CORS_ORIGINS` · `ENABLE_EMAIL_VERIFICATION` · `TWILIO_FROM` · all `VITE_*`

### Keys present in `server/.env` (⚠️ **names only — no values read or reproduced**)
```
PORT · NODE_ENV · CLIENT_URL · MONGO_URI ·
SUPER_ADMIN_EMAIL · SUPER_ADMIN_PASSWORD · SUPER_ADMIN_NAME ·
JWT_SECRET · JWT_EXPIRES_IN ·
JWT_COOKIE_EXPIRES_DAYS · REFRESH_TOKEN_DAYS · SESSION_IDLE_DAYS ·
SMTP_HOST · SMTP_PORT · SMTP_USER · SMTP_PASS · EMAIL_FROM ·
STORAGE_DRIVER · CLOUDINARY_URL · CLOUDINARY_CLOUD_NAME · CLOUDINARY_API_KEY ·
CLOUDINARY_API_SECRET · VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT ·
ENABLE_EMAIL_VERIFICATION · ENABLE_LOGIN_OTP · TWILIO_ACCOUNT_SID ·
TWILIO_AUTH_TOKEN · TWILIO_FROM · EXTRA_CORS_ORIGINS · DNS_SERVERS · REDIS_URL
```

**`server/.env` is a live secrets file containing real credentials.** Confirm it is git-ignored and never committed. Per project memory, `JWT_SECRET` has been rotated; the Atlas and SMTP credentials it holds should also be rotated.

**Three keys in `server/.env` are dead** — no `process.env` reference exists anywhere in `server/`:
- **`JWT_EXPIRES_IN`** — superseded by `JWT_ACCESS_EXPIRES` (which is *absent* from `server/.env`, so the access TTL is silently the `1h` code default). Anyone editing `JWT_EXPIRES_IN` expecting a change gets none.
- **`JWT_COOKIE_EXPIRES_DAYS`** — documented in `.env.example` but never read; the access cookie uses the hardcoded `ACCESS_COOKIE_MS` (1 h) and the refresh cookie uses `REFRESH_TOKEN_DAYS`.
- **`ENABLE_LOGIN_OTP`** — no code path reads it. Login is single-step password auth; there is no login-OTP feature to toggle.

Three vars are used in code but **missing from `server/.env.example`**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.

---

## 2.1 Core

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `PORT` | server — `server.js:27` | No | `5000` | HTTP listen port. Hosts like Render inject this. |
| `NODE_ENV` | server — `server.js:51,92`, `token.js:61`, `csrf.js:24`, `authController.js:113,123,299,592`, `error.js:29`, `db.js:11`, `seed.js:39` | **Yes in prod** | *(unset → dev behaviour)* | The master security switch. `production` turns on `Secure` + `SameSite=None` cookies, restricts CORS/CSRF to `CLIENT_URL`+extras, suppresses `devOtp` in responses, hides stack traces, switches Morgan to `combined`, and makes missing `MONGO_URI` / a weak `JWT_SECRET` fatal. |
| `CLIENT_URL` | server — `server.js:28`, `csrf.js:8`, `authController.js:453`, `meetingController.js:18`, `workspaceController.js:26` | **Yes in prod** | `http://localhost:5290` | Primary allowed browser origin (CORS + CSRF), and the base for emailed password-reset links, meeting `/meet/:code` links, and workspace invite links. Wrong value = broken CORS **and** broken email links. |
| `EXTRA_CORS_ORIGINS` | server — `csrf.js:9` | No | `''` | Comma-separated extra allowed origins (preview deploys, a second frontend domain). Trimmed, blanks dropped. |
| `DNS_SERVERS` | server — `db.js:26` | No | `8.8.8.8,1.1.1.1` | DNS resolvers used **only** when `MONGO_URI` contains `+srv`. Restrictive corporate networks refuse the SRV lookups Atlas needs (`querySrv ECONNREFUSED`); `dns.setServers()` routes around it, wrapped in try/catch to fall back to system DNS. |
| `SEED_CONFIRM` | server — `seed.js:27` | No | *(unset → refuses)* | Must equal `yes` (or pass `--yes`) to run the **destructive** demo seed. Hard-refuses when `NODE_ENV=production`. |

## 2.2 Database

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `MONGO_URI` 🔴 | server — `config/db.js:10`; tests `e2e.mjs:30`, `new-features.mjs:31`, `push-pipeline.mjs:29` | **Yes** (fatal in prod) | *(none — `process.exit(1)` in prod; boots DB-less with a warning in dev)* | MongoDB/Atlas connection string. **Include the `/chatconnect` database name** — omitting it silently uses `test`. Embeds the DB password → secret. |

## 2.2b The single super admin

Reconciled on **every boot** by `utils/superAdmin.js`, called from `server.js` right after
`ensureWorkspaces()`. This is what makes repointing `MONGO_URI` at an empty database survivable:
signup only ever creates a plain `user`, so without it a fresh database has **no admin and no way
to make one** short of running `utils/createAdmin.js` by hand.

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `SUPER_ADMIN_EMAIL` | server — `superAdmin.js` | Strongly recommended | *(none — boots with a warning and no guaranteed admin)* | The one account allowed to hold `role: 'admin'`. Created if absent, promoted + re-activated if present, and **every other admin is demoted to `user`** so there is exactly one. |
| `SUPER_ADMIN_PASSWORD` 🔴 | server — `superAdmin.js` | Yes, to create **or** to keep authoritative | *(none — an absent account is not created; <8 chars is treated as unspecified)* | **This file wins.** If the value differs from what's stored, the stored hash is replaced at boot and `tokenVersion` is bumped, signing the admin out of every device. An *unchanged* value is a no-op (bcrypt compare first) so restarts don't churn sessions. Consequences: a password changed in the Settings UI is reverted on the next restart — and on a hosted deploy, every deploy is a restart. Blank/short means "unspecified", never "reset to blank", so a cleared line can't lock you out. |
| `SUPER_ADMIN_NAME` | server — `superAdmin.js` | No | `Super Admin` | Display name used at creation only. |

Boot log tells you which branch ran: `Super admin created from .env: …` /
`… repaired (role, status, password) — password reset from .env, all previous admin sessions signed out` /
`… ✓` / `demoted N other admin(s)`, or a warning when unconfigured. Provisioning failure is caught —
the API still serves.

## 2.3 Auth / JWT / sessions

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `JWT_SECRET` 🔴 | server — `token.js:20,30,44,51`, `authController.js:58,65`, `server.js:52` | **Yes** | *(none — refuses to start in prod)* | HS256 signing key for **all five** JWT kinds (access, media, meeting pass, email proof). `validateEnv()` exits in production if it's <32 chars or the example placeholder. Rotating it invalidates every live session and pending email proof at once. |
| `JWT_ACCESS_EXPIRES` | server — `token.js:12` | No | **`1h`** | Access-token TTL (any `jsonwebtoken` expression: `15m`, `1h`, `2d`). **Caveat:** the `token` cookie's `maxAge` is hardcoded at 1 h, so raising this doesn't extend the cookie. Read once at module load. |
| `REFRESH_TOKEN_DAYS` | server — `session.js:7` | No | **`30`** | Absolute session lifetime — `Session.expiresAt` (also the TTL-index purge point) and the `refreshToken` cookie `maxAge`. Never extended by refresh. |
| `SESSION_IDLE_DAYS` | server — `session.js:8` | No | **`14`** | Idle window. A session untouched for longer fails `isSessionValid()`. `lastActiveAt` is bumped at most once per 5 minutes. |
| `JWT_EXPIRES_IN` | ❌ **not referenced anywhere** | — | — | **Dead.** Legacy of the pre-refresh stateless design. Superseded by `JWT_ACCESS_EXPIRES`. |
| `JWT_COOKIE_EXPIRES_DAYS` | ❌ **not referenced** (only in `.env.example`) | — | — | **Dead.** Cookie ages come from `ACCESS_COOKIE_MS` (hardcoded 1 h) and `REFRESH_TOKEN_DAYS`. |

## 2.4 Email / SMTP

`isEmailConfigured()` is true if **`BREVO_API_KEY`** is set, **or** if host **and** user **and** pass are *all* set. A host with blank credentials was the old default and silently failed to send. When unconfigured, mail is logged instead so dev OTP flows still work.

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `EMAIL_HOST` / `SMTP_HOST` | server — `sendEmail.js:15` | No (see above) | *(unset → SMTP off)* | SMTP hostname. `SMTP_*` are first-class aliases (people mix namings when copying provider docs). |
| `EMAIL_PORT` / `SMTP_PORT` | server — `sendEmail.js:16` | No | **`587`** | Port. `465` → implicit TLS (`secure: true`); `587`/`2525` → STARTTLS. |
| `EMAIL_USER` / `SMTP_USER` | server — `sendEmail.js:17` | No | *(unset)* | SMTP username. |
| `EMAIL_PASS` / `SMTP_PASS` 🔴 | server — `sendEmail.js:18` | No | *(unset)* | SMTP password / app password. **Secret.** |
| `EMAIL_FROM` | server — `sendEmail.js:144` | No | code fallback | `From:` header, e.g. `ChatKonect <no-reply@chatkonect.app>`. Must be a verified sender on Brevo/SES. |
| `BREVO_API_KEY` 🔴 | server — `sendEmail.js:24` | No | *(unset → SMTP path)* | HTTPS email via Brevo's API. **Takes priority over SMTP** and is effectively **required on Render's free plan, which blocks outbound ports 25/465/587 entirely** — an HTTP API on 443 always gets through. |

## 2.5 SMS

`isSmsConfigured()` requires **all three**. Twilio is called over `fetch` directly — no SDK. When unconfigured the caller falls back to email, so OTP flows work on any deployment. `sendSms` never throws on delivery failure; it returns `{ sent: false }`.

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID` 🔴 | server — `sendSms.js:11,18` | No | *(unset → SMS off)* | Twilio Account SID; also the REST URL path segment. |
| `TWILIO_AUTH_TOKEN` 🔴 | server — `sendSms.js:11,19` | No | *(unset)* | Twilio auth token (HTTP Basic). **Secret.** |
| `TWILIO_FROM` | server — `sendSms.js:11,26` | No | *(unset)* | Twilio-owned sending phone number. |

> All three are **missing from `server/.env.example`** — add them (blank) so the capability is discoverable.

## 2.6 Storage / uploads

`cloudStorageEnabled()` = `STORAGE_DRIVER === 'cloudinary'` **AND** (`CLOUDINARY_URL` **OR** `CLOUDINARY_CLOUD_NAME`).

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `STORAGE_DRIVER` | server — `storage.js:17` (lowercased) | No | **`local`** | `local` → files on disk behind the auth-gated `/uploads` route (**membership-gated per file**). `cloudinary` → Cloudinary CDN; URLs become **public-but-unguessable**. **Required for a multi-instance fleet** (local disk isn't shared and is ephemeral on Render). Documented trade-off: keep `local` if strict per-file authorization matters more than scaling. |
| `CLOUDINARY_URL` 🔴 | server — `storage.js:20` | If `cloudinary` | *(unset)* | `cloudinary://key:secret@cloud` — the SDK reads it automatically. **Embeds the API secret.** |
| `CLOUDINARY_CLOUD_NAME` | server — `storage.js:20,23,27` | Alt. to above | *(unset)* | Split-variable form. |
| `CLOUDINARY_API_KEY` 🔴 | server — `storage.js:28` | With cloud name | *(unset)* | Split-variable form. |
| `CLOUDINARY_API_SECRET` 🔴 | server — `storage.js:29` | With cloud name | *(unset)* | Split-variable form. **Secret.** |

## 2.7 Push / VAPID

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` | server — `push.js:11` | No | `''` → push disabled | VAPID public key. Generate the pair once: `node -e "console.log(require('web-push').generateVAPIDKeys())"`. |
| `VAPID_PRIVATE_KEY` 🔴 | server — `push.js:12` | No | `''` → push disabled | VAPID private key. **Secret.** |
| `VAPID_SUBJECT` | server — `push.js:13` | No | `mailto:support@chatkonect.app` | Contact URI required by the Web Push spec (`mailto:` or `https:`). |

Push activates only when **both** keys are set; bad keys are caught and logged (`⚠️ Web Push disabled — bad VAPID keys`) rather than crashing boot. Without push, in-app and socket notifications still work — push is what reaches a user whose tab is closed (a UX *and* scaling win, since no socket need be held). Subscription endpoints are restricted to a **host allowlist of known push services to eliminate SSRF**.

## 2.8 Realtime / LiveKit (SFU)

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `LIVEKIT_URL` | server — `livekit.js:12` | No | `''` → mesh mode | LiveKit `wss://…` URL. |
| `LIVEKIT_API_KEY` 🔴 | server — `livekit.js:13` | No | `''` | LiveKit API key. |
| `LIVEKIT_API_SECRET` 🔴 | server — `livekit.js:14` | No | `''` | Signs 3 h room-join tokens. **Secret.** |

`livekitEnabled()` requires **all three**. When set, meeting **media** routes through the SFU — each participant sends **one** upstream instead of one per peer, which is what lets a room scale past the ~6-person mesh ceiling. Signaling for chat/reactions/hand-raise/attendance still rides the app's own socket room, so only the media transport changes. Unset → the whole module is a no-op and meetings use the peer-to-peer mesh.

## 2.9 Redis / queue / scaling

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `REDIS_URL` 🔴 | server — `redis.js:14,21,35`, `queue.js:51`; consumed by `rateLimit.js` and the response cache | No | *(unset → single-instance)* | **The single flag that unlocks horizontal scaling.** Setting it turns on, together: the Socket.IO Redis adapter (cross-instance message/presence fan-out), a shared rate-limit store, response caching, and a BullMQ worker for notification/push fan-out. Unset → in-memory presence, per-process rate limits, inline jobs — identical behaviour, no extra infra. Usually embeds a password → secret. |

The adapter gets its own dedicated pub/sub pair (`getAdapterPair()`) separate from the command client, because the subscriber connection blocks. Redis errors are warned, never fatal. **To run more than one instance you need `REDIS_URL` *and* `STORAGE_DRIVER=cloudinary`** — otherwise uploads land on one instance's ephemeral disk.

## 2.10 Feature flags

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `ENABLE_EMAIL_VERIFICATION` | server — `authController.js:16`, `server.js:69,148` | No | *(unset → **falsy/off**)* | Strict `=== 'true'` string compare. When on: `/auth/signup` requires a valid `emailToken` proof, and login rejects unverified accounts (`403`). When off, both gates are skipped entirely. At boot, `true` with no mail transport errors in prod / warns in dev, and SMTP is verified with a `✅`/`⚠️` log line so "why isn't the OTP arriving?" is obvious. |
| `ENABLE_LOGIN_OTP` | ❌ **not referenced** (present in `server/.env`) | — | — | **Dead.** No login-OTP code path exists. |

## 2.11 Client (`VITE_*`) — all public, baked in at build time

| Variable | Where used | Required? | Default if unset | What it does |
|---|---|---|---|---|
| `VITE_API_URL` | client — `lib/api.js:13,97`, `hooks/useSocket.js:55`, `pages/DevelopersPage.jsx:24,26`, `pages/SettingsPage.jsx:718` | **Yes in prod** | `'/api'` (dev proxy / same-origin) | API base. Accepts a bare origin **or** a full `/api` base — `resolveApiBase()` normalizes both. Also seeds socket-URL resolution and the docs/settings display. |
| `VITE_SOCKET_URL` | client — `hooks/useSocket.js:54` | No | *(derived — see §2.13)* | Explicit Socket.IO URL; **highest priority**. Should be the backend **origin, no `/api`**. |
| `VITE_DEMO_MODE` | client — `lib/api.js:93` | No | *(unset → `false`)* | Strict `=== 'true'`. Runs the whole UI on mock data. Previously a *blank* `VITE_API_URL` implicitly forced demo mode, which silently mocked login/chat/calls even with the backend running — now it must be opted into explicitly. |
| `VITE_TURN_URL` 🟡 | client — `lib/iceServers.js:21,23` | No (needed for real calls) | *(unset → STUN only)* | Comma-separated TURN URLs. **Without a TURN relay, calls across strict NATs (mobile, corporate wifi) ring and "connect" but media never flows and the call auto-drops.** There is deliberately **no default** — the old `openrelay.metered.ca` fallback was shut down and only slowed ICE while still leaving calls medialess. |
| `VITE_TURN_USERNAME` 🟡 | client — `lib/iceServers.js:24` | With `VITE_TURN_URL` | `''` | Static TURN username. |
| `VITE_TURN_CREDENTIAL` 🟡 | client — `lib/iceServers.js:25` | With `VITE_TURN_URL` | `''` | Static TURN credential — **visible in the bundle**. Prefer the endpoint below. |
| `VITE_TURN_CREDENTIALS_URL` 🟡 | client — `lib/iceServers.js:27,31` | No | *(unset)* | Endpoint returning **time-limited** TURN credentials (one ice-server object or an array), e.g. metered.ca's `/api/v1/turn/credentials?apiKey=…`. Fetched once at startup; connections created before it resolves fall back to STUN for that session, and every subsequent call/meeting is upgraded since `ICE_SERVERS` is read at `RTCPeerConnection` creation time. **Only used when `VITE_TURN_URL` is absent** (`else if`). |
| `import.meta.env.PROD` | client — `lib/api.js:97` | built-in | — | Guards the loud console error when a production build has no `VITE_API_URL`. |
| `import.meta.env.DEV` | client — `hooks/useSocket.js:57` | built-in | — | Selects the direct-to-`:5000` socket connection in dev. |

**Env-file layering** (Vite: `.env` < `.env.[mode]`, later wins):
- `client/.env` — `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_DEMO_MODE`, all four `VITE_TURN_*`
- `client/.env.development` — blank URLs + `VITE_DEMO_MODE=false`, so `npm run dev` always targets the **local** backend and never drifts onto the deployed one
- `client/.env.production` — `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_DEMO_MODE`

---

## 2.12 API base URL resolution

`resolveApiBase()` — `client/src/lib/api.js:12`:

```js
const raw = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
if (!raw) return '/api';
return /\/api$/i.test(raw) ? raw : `${raw}/api`;
```

| `VITE_API_URL` | Resolved `baseURL` |
|---|---|
| *(blank / unset)* | `/api` — relative, same-origin |
| `https://api.example.com` | `https://api.example.com/api` (suffix added) |
| `https://api.example.com/api` | unchanged |
| `https://api.example.com/api/` | `https://api.example.com/api` (trailing slashes stripped) |

**The result always ends in `/api`.** This exists to kill the classic production bug where the var is set to the bare backend origin and every request 404s with `Route not found: /auth/login`.

**Dev** — blank → `baseURL = '/api'`, and Vite's proxy (`client/vite.config.js:49`) forwards `/api`, `/socket.io`, and `/uploads` to `http://localhost:5000` (`ws: true` on the socket entry). Dev server: port **5290**, `strictPort: true` (a clash fails loudly instead of drifting), `host: true` (LAN-accessible). Same-origin means `SameSite=Lax` cookies work over plain HTTP — matching `sessionCookieOptions()`'s dev branch.

**Prod** — cross-origin (Vercel frontend → Render backend). `withCredentials: true` + `SameSite=None; Secure` cookies + backend `CLIENT_URL` pointing at the frontend origin. If a production build has no `VITE_API_URL`, `api.js:97` logs an explicit `console.error`, because every `/api` call would otherwise hit the static host (Vercel answers POSTs with `405`).

**Warm-up ping** — `api.js:29` fires a fire-and-forget `fetch(baseURL + '/health', { cache: 'no-store' })` at module load. Free-tier hosts sleep idle backends and the first request eats a ~50 s cold start; pinging at page load means the server wakes **while the user types their credentials** rather than when they hit "Sign in".

**Media URLs** — `mediaUrl(u)` (`api.js:137`) passes through `http(s):`/`data:`/`blob:` untouched; otherwise it derives the origin by stripping `/api` from `baseURL` (→ `''` when proxied) and appends `?token=<mediaToken>` (`&` if a query already exists), URL-encoded.

## 2.13 Socket URL resolution

`resolveSocketUrl()` — `client/src/hooks/useSocket.js:53`, in priority order:

1. **`VITE_SOCKET_URL`** if set → used verbatim.
2. Else if `VITE_API_URL` is **absolute** (`/^https?:\/\//i`) → its origin, via `api.replace(/\/api\/?$/, '')`. This is the normal production path — one var configures both.
3. Else if **`import.meta.env.DEV`** → `` `${window.location.protocol}//${window.location.hostname}:5000` ``.
4. Else → **`undefined`** → Socket.IO defaults to same-origin (prod served from one host).

**Why dev connects straight to `:5000` instead of same-origin:** routing the socket through Vite's `/socket.io` proxy makes the WebSocket upgrade flaky and spams `ws proxy socket error: write ECONNABORTED` on every reconnect. Socket.IO does its own CORS, and the backend already allows localhost/LAN origins in dev, so a direct connection is clean. Using `window.location.hostname` (not a hardcoded `localhost`) keeps LAN testing working.

**Transports:** `['websocket', 'polling']` — WebSocket preferred, long-polling only as fallback.

## 2.14 Server-side CORS / origin handling

One allowlist, two consumers. `isAllowedOrigin()` (`server/middleware/csrf.js:14`) is used by **both** `corsOrigin()` in `server.js:36` (Express **and** Socket.IO) and `csrfGuard`, so the two can never drift.

- **Allowed always:** `CLIENT_URL` (default `http://localhost:5290`) + every entry in `EXTRA_CORS_ORIGINS`.
- **Allowed in dev only** (`NODE_ENV !== 'production'`): any origin matching `/^https?:\/\/(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?$/`.
- **No `Origin` header** → `true` (curl, server-to-server, same-origin requests) — such callers carry no ambient session cookie to abuse.
- A `Referer` URL is normalized to its origin via `new URL(origin).origin`.
- Both Express CORS and the Socket.IO server are created with `credentials: true`, which is mandatory for cookie-based auth.
- `corsOrigin()` returns `cb(null, false)` — never throws — so a disallowed origin gets a clean CORS denial rather than a 500, leaving `csrfGuard` as the explicit 403 gate.

### Production checklist
| Set on | Variable | Value |
|---|---|---|
| Backend (Render) | `CLIENT_URL` | `https://your-frontend.vercel.app` |
| Backend | `NODE_ENV` | `production` |
| Backend | `JWT_SECRET` | ≥32 random chars |
| Backend | `MONGO_URI` | Atlas SRV **with** `/chatconnect` |
| Backend | `BREVO_API_KEY` | required on Render free (SMTP ports blocked) |
| Frontend (Vercel) | `VITE_API_URL` | `https://your-backend.onrender.com` (with or without `/api`) |
| Frontend | `VITE_SOCKET_URL` | `https://your-backend.onrender.com` (**no** `/api`) |
| Frontend | `VITE_DEMO_MODE` | `false` |

A mismatch between `CLIENT_URL` and the real frontend origin is the single most common production failure: cookies are dropped, CORS blocks reads, `csrfGuard` 403s every mutation, and emailed reset/meeting/invite links point at the wrong host.
agentId: ab98aed9ff8344acf (use SendMessage with to: 'ab98aed9ff8344acf', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 115714
tool_uses: 44
duration_ms: 471134</usage>
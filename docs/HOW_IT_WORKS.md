# ChatConnect — How It Works

This document explains **what ChatConnect is**, **how the codebase is organised**, and
**the end-to-end flow** of every major feature (auth, chat, calls, meetings, the
multi-tenant workspace model, and the public API).

> TL;DR — ChatConnect is a production-style, multi-tenant real-time messaging
> **SaaS**. Users sign up into their own **workspace** (organisation), chat 1:1 and
> in groups, make audio/video calls (WebRTC) with screen sharing, schedule
> meetings, and can integrate everything into their own product via a scoped
> **REST API**.

---

## 1. Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, React Router v6, **Zustand** (state), Tailwind CSS, Framer Motion, Lucide icons, `socket.io-client`, WebRTC |
| Backend | Node.js (ESM) + Express, **Mongoose**/MongoDB, **Socket.IO**, JWT auth, Nodemailer |
| Realtime | Socket.IO (chat, presence, receipts, call signaling) + WebRTC (P2P media) |
| Auth | JWT (httpOnly cookie **and** Bearer token), bcrypt, OTP email verification, `tokenVersion` session revocation |
| Media | Multipart upload, token-gated `/uploads`, optional Cloudinary |

The frontend can also run in **DEMO_MODE** (`VITE_DEMO_MODE=true`), which uses local
fixture data and never calls the backend — useful for UI previews.

---

## 2. Repository layout

```
whatapp clone/
├─ client/                     # React + Vite frontend
│  └─ src/
│     ├─ main.jsx              # App bootstrap (BrowserRouter)
│     ├─ App.jsx               # Routes (public + protected shell)
│     ├─ pages/                # One component per screen
│     │  ├─ auth/              # Login, Signup, VerifyOtp, Forgot/ResetPassword
│     │  ├─ ChatsPage, CallsPage, MeetingsPage, StatusPage,
│     │  ├─ GroupsPage, ContactsPage, SettingsPage,
│     │  ├─ DevelopersPage     # API keys + docs (dedicated top-level page)
│     │  └─ AdminDashboard
│     ├─ components/
│     │  ├─ layout/            # NavRail, MobileNav, TopBar, AppLayout
│     │  ├─ chat/              # ChatArea, ChatHeader, ChatSidebar, MessageList,
│     │  │                     #   MessageBubble, MessageComposer, RightPanel
│     │  ├─ overlays/          # CallOverlay (the in-call UI)
│     │  ├─ modals/            # ModalHost (new chat, group, meeting, forward…)
│     │  └─ ui/                # Design-system primitives (Button, Input, Modal…)
│     ├─ store/                # Zustand stores (see §10)
│     ├─ hooks/                # useSocket (realtime), useWebRTC (calls)
│     └─ lib/                  # api.js (axios), chat.js (helpers), utils.js
│
├─ server/                     # Express + Mongoose backend
│  ├─ server.js                # Entry: env validation, middleware, boot, migration
│  ├─ config/db.js             # Mongo connection
│  ├─ models/                  # Mongoose schemas (see §7)
│  ├─ controllers/             # Route handlers (business logic)
│  ├─ routes/                  # Express routers, mounted under /api (routes/index.js)
│  ├─ middleware/              # auth (protect), apiKey, sanitize, upload, rateLimit
│  ├─ socket/index.js          # Socket.IO server (chat + presence + call signaling)
│  └─ utils/                   # token, sendEmail, callService, workspaceService, seed…
│
└─ docs/
   ├─ HOW_IT_WORKS.md          # (this file)
   └─ API_V1.md                # Public third-party API reference
```

---

## 3. High-level architecture

```
                    ┌─────────────────────────────────────────────┐
                    │                 Browser (SPA)                │
                    │  React + Zustand                             │
                    │   • axios  ──── REST ───►                    │
                    │   • socket.io-client ─ realtime ─►           │
                    │   • RTCPeerConnection ─ P2P media ─► (peer)  │
                    └───────────────┬──────────────────────────────┘
                                    │ HTTPS / WSS
                    ┌───────────────▼──────────────────────────────┐
                    │              Express server                  │
                    │  /api/*  REST controllers                    │
                    │  Socket.IO  (rooms: user:<id>, chat:<id>)    │
                    │  JWT auth (protect) · X-API-Key (apiKeyAuth) │
                    └───────────────┬──────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────┐   ┌────────────────┐
                    │        MongoDB (Mongoose)     │   │  SMTP (OTP)    │
                    │  Users, Workspaces, Chats,    │   │  (optional)    │
                    │  Messages, Calls, Meetings…   │   └────────────────┘
                    └───────────────────────────────┘

Call media (audio/video/screen) flows PEER-TO-PEER between browsers.
The server only relays SDP offers/answers + ICE candidates (signaling).
```

Two independent realtime channels:
- **Socket.IO** carries chat messages, typing, presence, delivery/read receipts, and
  call **signaling** (the setup handshake).
- **WebRTC** carries the actual call **media** directly between peers (with Google
  STUN, and an optional TURN relay via `VITE_TURN_*`).

---

## 4. Authentication & request lifecycle

Every protected request is authenticated by the [`protect`](../server/middleware/auth.js) middleware:

1. Read the JWT from the `Authorization: Bearer <token>` header **or** the `token` cookie.
2. Verify the signature (`JWT_SECRET`) and decode `{ id, role, tokenVersion }`.
3. Load the user; reject if missing, if `accountStatus !== 'active'`, or if the
   token's `tokenVersion` no longer matches the user's (→ **session revocation**:
   changing/resetting a password or being banned bumps `tokenVersion`, instantly
   invalidating every old token).
4. Attach the user to `req.user` — controllers then operate as that user.

The Socket.IO server performs the **same** checks in `io.use(...)` during the
handshake, so a banned user or revoked token can't hold a live socket open.

The public API uses a parallel middleware, [`apiKeyAuth`](../server/middleware/apiKey.js),
that authenticates an `X-API-Key` header and sets `req.user` to the key's owner
(see §9).

---

## 5. Core flow: Signup → Workspace → Login

ChatConnect is **multi-tenant**: every user belongs to exactly one **Workspace**
(organisation), and can only interact with people **in the same workspace**.

### Signup ([`authController.signup`](../server/controllers/authController.js))
```
POST /api/auth/signup { name, email, password, workspaceName?, inviteCode? }
        │
        ├─ validate input, ensure email not taken
        ├─ if inviteCode present → validate it (400 if bad)
        ├─ create User (role 'user' always; password hashed by pre-save hook)
        ├─ provision workspace:
        │      • inviteCode given  → JOIN that workspace as 'member'
        │      • otherwise         → CREATE a new workspace, user becomes 'owner'
        └─ if ENABLE_EMAIL_VERIFICATION:
               → generate OTP, email it, return { requiresVerification, email }
             else:
               → issue JWT immediately (auto-login)
```

### OTP verification ([`verifyOtp`](../server/controllers/authController.js))
```
POST /api/auth/verify-otp { email, otp }
   → checks code + expiry + attempt lockout (≥5 wrong → 429)
   → marks isVerified, clears OTP, issues JWT
```
(When SMTP isn't configured in development, the OTP is returned as `devOtp` so you
can still complete signup.)

### Login ([`login`](../server/controllers/authController.js))
```
POST /api/auth/login { email, password }
   → verify bcrypt hash → check verified + active → issue JWT
```

The JWT is returned in the body (stored in `localStorage` as `cc_token`) **and** set
as an httpOnly cookie. On the client, [`useAuth.init()`](../client/src/store/useAuth.js)
calls `GET /api/auth/me` on load to restore the session.

### Multi-tenant isolation (the SaaS boundary)
Enforced server-side wherever users discover or reach each other:
- **User search** ([`searchUsers`](../server/controllers/userController.js)) filters by `workspace`.
- **Contact requests** ([`contactController`](../server/controllers/contactController.js)) reject cross-workspace targets (403).
- **Direct chat** ([`accessDirectChat`](../server/controllers/chatController.js)) requires same workspace; sets `chat.workspace`.
- **Group membership** ([`groupController`](../server/controllers/groupController.js)) only adds same-workspace members.
- **API keys** act as their owner, so they're automatically workspace-scoped.

Owners share an **invite link** (`/signup?invite=<code>`) from **Settings → Workspace**
to bring teammates into their org. A boot-time idempotent migration
([`ensureWorkspaces`](../server/utils/workspaceService.js)) moves any pre-existing
users/chats into a "Default Workspace" so upgrades never break existing data.

---

## 6. Core flow: Sending a message + delivery/read ticks

Messages are stored once and fanned out over Socket.IO for instant delivery.

```
Sender types → POST /api/messages { chatId, content, type, replyTo?, attachments? }
   server (messageController.sendMessage):
     • assert sender is a chat member
     • create Message (deliveredTo:[sender], readBy:[sender])
     • set chat.lastMessage
     • FAN-OUT: emit 'receive-message' to EACH participant's PERSONAL room
       (user:<id>) — not just the chat room — so online users get it instantly
       even without the chat open (this is what keeps latency low)

Recipient device receives 'receive-message':
     • appends the message
     • emits 'message:delivered' ──► server persists deliveredTo + broadcasts
                                     'message:status' (delivered)
     • if the chat is open + visible: emits 'message:read' ──► server persists
                                     readBy + broadcasts 'message:read'
```

The **ticks** on the sender's bubble ([`MessageBubble`](../client/src/components/chat/MessageBubble.jsx),
computed by [`lib/chat.js` `messageStatus`](../client/src/lib/chat.js)):

| Ticks | Meaning |
|-------|---------|
| ✓ (single, grey) | **sent** — persisted on the server |
| ✓✓ (double, grey) | **delivered** — reached the recipient's device |
| ✓✓ (double, cyan) | **read** — recipient opened the chat |
| ❗ (red) | **failed** to send |

### Message actions (WhatsApp-style)
All available from the message hover menu:
- **Reply**, **React** (persisted, one per user), **Star**, **Pin**, **Copy**, **Forward**
- **Edit** (own text messages; inline; broadcasts `message-edited`)
- **Delete for me** (`?scope=me` → hidden for you) vs **Delete for everyone**
  (`?scope=everyone` → replaced with a "This message was deleted" tombstone for all)

Edits, deletes, and reactions **sync live** to the other side via socket events
(`message-edited`, `message-deleted`, `message-reaction`) handled in
[`useSocket`](../client/src/hooks/useSocket.js).

---

## 7. Core flow: Calls (WebRTC)

Call **signaling** is relayed by Socket.IO; call **media** is peer-to-peer.
Logic lives in [`useWebRTC`](../client/src/hooks/useWebRTC.js) (client) and
[`socket/index.js`](../server/socket/index.js) (relay), with call **history** persisted
via [`callService.transitionCall`](../server/utils/callService.js).

### 1:1 call handshake
```
Caller                         Server (relay)                     Callee
  │ getUserMedia (cam/mic)                                          │
  │ POST /api/calls/start ─────►  create Call record, report        │
  │      { receiverId, type }     receiverOnline                    │
  │ emit 'call:invite' ─────────► 'call:incoming' ────────────────► │ (ring)
  │                                                                 │ accept
  │ ◄──────────── 'call:accepted' ◄──── emit 'call:accept' ─────────┤
  │ createOffer → setLocalDesc                                      │
  │ emit 'call:offer' ──────────► relay ──────────────────────────► │ setRemoteDesc
  │                                                                 │ createAnswer
  │ ◄──────────── 'call:answer' ◄──────── emit 'call:answer' ───────┤
  │ ◄───────► 'call:ice-candidate' (both directions, relayed) ◄───► │
  │ ════════════════ P2P media connected (RTCPeerConnection) ═══════│
  │ emit 'call:end' ────────────► 'call:ended' ───────────────────► │
```

Every transition (`accept` / `reject` / `missed` / `end`) is persisted, so **call
history** (missed / rejected / completed + duration) stays correct for both users
even if a client dies mid-call. Ringing/offer are **gated on a mutual-contact
relationship** so strangers can't ring you.

### Group calls (star topology)
"Add people" during a call rings extra contacts into the **same `callId`**. Each
invited person connects **to the host** (a star/hub), so the host sees everyone and
each guest sees the host. The client keeps a `Map<remoteUserId, RTCPeerConnection>`
(1:1 is just the N=1 case). *(Full mesh — where guests also see each other — needs an
SFU and is future work.)*

### In-call controls ([`CallOverlay`](../client/src/components/overlays/CallOverlay.jsx))
- **Mute**, **Camera** (video calls)
- **Speaker** — switches audio output device (`setSinkId`)
- **Present** — screen share via `getDisplayMedia` + `replaceTrack` on every peer,
  with a Google-Meet-style "You're presenting" banner (video calls only)
- **Add people** — contact picker that rings guests in
- **Chat** — minimises the call to a floating pill and opens the conversation (media keeps running)
- **Fullscreen**, **Minimise**, **Hang up**

---

## 8. Other features (in brief)

| Feature | How it works |
|---------|--------------|
| **Contacts** | Consent-based: `POST /contacts/request/:id` → the other person accepts (`PATCH /contacts/request/:id`). Only then can you open a 1:1 chat. Same-workspace only. |
| **Groups** | A `Chat` with `isGroup:true`, participants with roles (owner/admin/member), invite codes, and a messaging policy (all / admins only). |
| **Meetings** | Scheduled events ([`Meeting`](../server/models/Meeting.js)) with a host, invitees, start time, and RSVP; joining a meeting starts a call. |
| **Status** | Ephemeral "stories" ([`Status`](../server/models/Status.js)) with privacy controls. |
| **Notifications** | Persisted bell notifications + live socket toasts (messages, contact requests, status replies). |
| **Media/uploads** | Files upload via multipart; `/uploads` is **token-gated** — a short-lived media token + per-chat participant check ([`mediaController`](../server/controllers/mediaController.js)) prevents anyone from reading another chat's files by URL. |
| **Admin** | Platform super-admin (`role:'admin'`) dashboard to view/manage users (ban/suspend bumps `tokenVersion`). |

---

## 9. The public API (third-party integration)

Lets another platform build on ChatConnect. Full reference: [docs/API_V1.md](./API_V1.md).

- **Key model** ([`ApiKey`](../server/models/ApiKey.js)): keys look like `cc_live_…`,
  are stored only as **SHA-256 hashes**, carry **scopes**, and are created/revoked
  by users in **Settings → Developer** or the **Developers** page.
- **Auth** ([`apiKeyAuth`](../server/middleware/apiKey.js)): send `X-API-Key`. The key
  **acts as its owner** — `req.user = owner` — so every `/api/v1` endpoint reuses the
  exact same secured controllers the app uses. A key can never exceed its owner's
  permissions, scopes, **or workspace**.
- **Endpoints** ([`v1Routes`](../server/routes/v1Routes.js)): `/me`, `/contacts`,
  `/users/search`, `/chats`, `/chats/direct/:userId`, `/messages` (GET/POST),
  `/calls`, `/meetings` (GET/POST) — each gated by the right scope.
- **Rate limit**: 120 requests/min per key.

```
Your server ──► curl -H "X-API-Key: cc_live_…" .../api/v1/messages
                     -d '{"chatId":"…","content":"Hi from our app"}'
             ──► message is sent AS the key's owner, in the owner's workspace
```

---

## 10. Frontend state (Zustand stores)

| Store | Responsibility |
|-------|----------------|
| [`useAuth`](../client/src/store/useAuth.js) | Session: `user`, `init()`, `login`, `signup`, `verifyOtp`, `logout` |
| [`useChat`](../client/src/store/useChat.js) | Chats, messages, typing, presence; send/edit/delete/forward/react; `openDirectChat`, `createGroup` |
| [`useUI`](../client/src/store/useUI.js) | Theme, panels, active modal, and the **active call** (`startCall`/`endCall`/`minimizeCall`) |
| [`useContacts`](../client/src/store/useContacts.js) | Contacts, favourites, requests |
| [`useMeetings`](../client/src/store/useMeetings.js) | Meetings list + create + RSVP |
| [`useWorkspace`](../client/src/store/useWorkspace.js) | Current org: members, invite link, rename, rotate invite, roles |
| [`useApiKeys`](../client/src/store/useApiKeys.js) | Developer API keys: list/create/revoke |
| [`useNotifications`](../client/src/store/useNotifications.js) | Bell notifications |
| [`useStatus`](../client/src/store/useStatus.js) | Status/stories |

Realtime is centralised in [`useSocket`](../client/src/hooks/useSocket.js): it opens
one authenticated socket, exposes `emitSocket(event, payload)`, and routes every
inbound event into the right store (messages, receipts, presence, call signaling,
edit/delete/reaction sync).

The app shell ([`AppLayout`](../client/src/components/layout/AppLayout.jsx)) stays
mounted across navigation (nav rail + socket + call overlay never remount); only the
routed page inside the `<Outlet>` swaps.

---

## 11. Data models (MongoDB / Mongoose)

| Model | Key fields | Notes |
|-------|-----------|-------|
| **User** | name, username, email, password(hash), avatar, role, accountStatus, **workspace**, **workspaceRole**, tokenVersion, contacts[], blockedUsers[], privacy, settings | `role` = platform level; `workspaceRole` = org level |
| **Workspace** | name, slug, owner, **inviteCode**, plan | The tenant boundary |
| **Chat** | **workspace**, isGroup, participants[{user,role}], name, inviteCode, pinnedMessages[], lastMessage | Unified 1:1 + group |
| **Message** | chat, sender, type, content, attachments[], replyTo, reactions[], deliveredTo[], readBy[], starredBy[], isDeleted, deletedFor[], forwardedFrom, isEdited | Drives ticks + actions |
| **ContactRequest** | from, to, status (pending/accepted/rejected) | Consent-based contacts |
| **Call** | initiator/caller, receiver, participants[], type, status, duration | History + transitions |
| **Meeting** | host, title, startAt, participants[], type | Scheduled calls |
| **Status** | user, content/media, expiresAt, viewers[] | Ephemeral stories |
| **Notification** | user, from, type, title, body, data, read | Bell + toasts |
| **ApiKey** | owner, label, hashedKey, prefix, scopes[], lastUsedAt | Public API auth |
| **Report** | reporter, target, reason | Moderation |

---

## 12. Socket.IO events (reference)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `join-chat` / `leave-chat` | client → server | Join a chat room (membership-checked) |
| `receive-message` | server → clients | New message fan-out |
| `typing-start` / `typing-stop` | both | Typing indicators |
| `message:delivered` / `message:read` | client → server | Report receipts |
| `message:status` / `message:read` | server → clients | Update ticks |
| `message-edited` / `message-deleted` / `message-reaction` | server → clients | Live message-action sync |
| `call:invite` → `call:incoming` | via server | Ring the callee |
| `call:accept` / `call:reject` / `call:cancel` / `call:end` | via server | Call lifecycle |
| `call:offer` / `call:answer` / `call:ice-candidate` | via server | WebRTC signaling |
| `presence-snapshot` / `user-online` / `user-offline` | server → clients | Presence |
| `contact-request` / `contact-accepted` | server → client | Contact notifications |

Rooms: `user:<userId>` (all a user's devices) and `chat:<chatId>` (a conversation).

---

## 13. Environment variables

**Server** (`server/.env`)
```
MONGO_URI=mongodb+srv://…/chatconnect      # include the DB name!
JWT_SECRET=<32+ char random secret>
NODE_ENV=production
PORT=5000
CLIENT_URL=https://your-frontend           # CORS + invite/reset links (no trailing slash)
ENABLE_EMAIL_VERIFICATION=true|false
EMAIL_HOST= EMAIL_PORT= EMAIL_USER= EMAIL_PASS=   # SMTP (only if verification on)
```

**Client** (`client/.env`)
```
VITE_API_URL=https://your-backend          # normalised to end with /api
VITE_SOCKET_URL=https://your-backend
VITE_DEMO_MODE=false
VITE_TURN_URL= VITE_TURN_USERNAME= VITE_TURN_CREDENTIAL=   # optional TURN for calls
```

---

## 14. Running & deploying

**Local development**
```bash
# backend
cd server && npm install && npm run dev      # http://localhost:5000

# frontend (separate terminal)
cd client && npm install && npm run dev      # http://localhost:5173
```
In dev the frontend talks to the backend directly (socket connects to `:5000`).

**Production**
- **Frontend** → Vercel (static build of `client/`). Set the `VITE_*` env vars.
- **Backend** → Render/Railway/any Node host. Set the server env vars; the
  workspace migration runs automatically at boot.
- **Database** → MongoDB Atlas (allow the backend's IP / `0.0.0.0/0`).
- First super-admin: use `server/utils/createAdmin.js`. **Never** run `npm run seed`
  against production — it is destructive (guarded behind `SEED_CONFIRM`).

---

## 15. Security highlights

- JWT with `tokenVersion` revocation; same checks on REST **and** sockets.
- Password hashing (bcrypt cost 12); OTP with attempt lockout.
- **Multi-tenant isolation** at every discovery/contact/chat/group boundary.
- Consent-based contacts + mutual-contact gate on calls.
- NoSQL-injection sanitisation ([`middleware/sanitize.js`](../server/middleware/sanitize.js)); input type-guards.
- Token-gated media downloads.
- API keys stored only as SHA-256 hashes, scoped, rate-limited, revocable.
- Signup can only ever create a regular user; admin is created only via seed/promotion.

---

*Generated as living documentation. If a flow changes, update this file alongside the code.*

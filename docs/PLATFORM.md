# ChatKonect — Embeddable Platform

How to put ChatKonect's chat, calls and meetings **inside another product**.

Every fact below was extracted from the source (`server/routes/platformRoutes.js`,
`server/controllers/platformController.js`, `server/utils/appAuth.js`, `server/models/App.js`,
`server/utils/tenancy.js`) and cross-checked against the route definitions. Where a doc and the code
disagree, the code wins.

There are two audiences here, and they need different halves of this document:

| You are… | Read |
|---|---|
| The **ChatKonect operator** — you own the admin console and create the apps | §1 – §3 |
| A **third-party developer** who wants the whole UI dropped in | **§10** (start here) |
| A **third-party developer** building their own frontend against the API | §4 – §8 |

> **Read §9 before you promise anything to a customer.** Most capability toggles are still not
> enforced server-side — §9.1 says exactly which, and it matters if you are packaging or billing on
> them. The drop-in embed IS built: see §10.

---

## 1. The mental model

**One "App" = one tenant.** An App is an isolated world: its end users can only see, search and
message other users of the same App. They cannot see your first-party ChatKonect users, and those
users cannot see them. Isolation is enforced server-side by `tenantScope()` on every user-facing
query, not by the UI hiding things.

Each App has **two credentials, and the difference between them is the whole security model:**

| | **App ID** | **App secret** |
|---|---|---|
| Looks like | `app_c2131fcf274bc829` | `cc_sk_pruBiS9M…` |
| Public? | **Yes** — safe in a frontend bundle | **No — server-side only, ever** |
| Can do | Identifies the tenant | Provision users, mint user tokens for the whole tenant |
| Lives in | Your web app, your config | Your backend environment variables |

The secret is shown **once**, at creation or rotation. Only its SHA-256 digest is stored, so nobody —
including you — can read it back out of the database. Lose it and you rotate.

From the secret your backend mints a **user token**: short-lived, scoped to exactly one end user.
That is the only credential a browser is ever allowed to hold.

```
your backend  ──[App ID + App secret]──►  POST /api/v1/platform/tokens
                                                    │
                                          returns a user token (default 60 min)
                                                    ▼
your frontend ──[user token]───────────►  the rest of the ChatKonect API
```

**Why the split matters:** a leaked user token exposes one person for minutes. A leaked app secret
exposes every user in the tenant until you rotate it. That is why the secret must never reach a
browser, a mobile app, a git repo, or a client-side environment variable.

---

## 2. Using the Platform tab (operator)

`/platform` in the admin console. Admin-only — non-admins are redirected, and every underlying
endpoint independently returns 403, so the route guard is convenience, not the control.

### Create an app

**New app** → give it a name → the secret is displayed. **Copy it now**; this is the only time it is
shown. Hand the App ID and secret to your customer over a secure channel (a password manager share,
not email or chat).

A new app starts with the messaging core enabled and the heavier surfaces off:

`chat`, `groups`, `presence`, `typing`, `receipts`, `reactions`, `attachments`

### The header row

| Field | Meaning |
|---|---|
| **App ID (public)** | The tenant identifier. Copy button beside it. Safe to share. |
| **Secret** | Masked after creation (`cc_sk_pruBiS9M••••••••`). Only the prefix is recoverable. |
| **Users** | End users provisioned for this app. |
| **Active** | Of those, how many are not suspended. |
| **Tokens issued** | Lifetime count of `POST /tokens` calls — a rough activity signal. |
| **Seat limit** | `limits.maxUsers`. Provisioning past it returns **429**. |

### Capabilities

Thirteen toggles. **Only four are enforced by the server today** — see §9.1 before you rely on these
for billing or packaging.

| Flag | Label in the console | Enforced server-side? |
|---|---|---|
| `groups` | Group chats | **Yes** — all of `/api/groups` |
| `calls` | Voice calls | **Yes** — all of `/api/calls` |
| `meetings` | Meetings | **Yes** — all of `/api/meetings` |
| `status` | Status / stories | **Yes** — all of `/api/status` |
| `chat` | Direct messaging | No |
| `video` | Video calls | No — video rides the `calls` router |
| `presence` | Presence | No |
| `typing` | Typing indicators | No |
| `receipts` | Read receipts | No |
| `reactions` | Reactions | No |
| `attachments` | Attachments | No |
| `voiceNotes` | Voice notes | No |
| `push` | Web push | No |

Turning an enforced flag off makes its endpoints return:

```json
{ "success": false, "message": "The \"meetings\" feature is not enabled for this app." }
```
…with HTTP **403**.

### Seat limit and token lifetime

| Setting | Default | Accepted range | Notes |
|---|---|---|---|
| **Seat limit** | 10 000 | 1 – 1 000 000 | Values outside the range are clamped, not rejected. |
| **User-token lifetime (minutes)** | 60 | 5 – 1440 | Clamped. Shorter is safer; the host re-mints on demand. |

### Rotate secret / Disable app

- **Rotate secret** — issues a new secret and invalidates the old one **immediately**. Every backend
  using the old secret starts getting `401 Invalid app secret` on its next call. Coordinate this with
  your customer; it is not a graceful rollover.
- **Disable app** — sets `active: false`. All platform calls return `403 This app is disabled.`
  Existing user tokens keep working until they expire (they are ordinary access tokens), so disabling
  is not an instant kill switch for sessions already in flight.

### The Integrate snippet

The snippet in the panel is copy-pasteable but uses `http://localhost:5000` — the **development**
API base. Give your customer the deployed host instead (see `docs/ENVIRONMENT.md`). Its step 3 says
"hand that token to the embed" — that embed is real; §10 is the current reference for it.

---

## 3. Operator API (admin console)

Session-authenticated (`protect` + admin), mounted at `/api/apps`. This is what the Platform tab
calls; you only need it if you are scripting tenant management.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/apps` | List apps you own (platform admins see all). |
| `POST` | `/api/apps` | Create an app. `{ name, features? }` → **returns the secret once**. |
| `PATCH` | `/api/apps/:id` | Update `name`, `active`, `features`, `allowedOrigins`, `limits`. |
| `POST` | `/api/apps/:id/rotate` | New secret; old one dies immediately. |
| `POST` | `/api/apps/:id/disable` | Set `active: false`. |
| `GET` | `/api/apps/:id/stats` | Usage counters. |

A caller only ever sees apps they own; users with `role: 'admin'` see every app.

---

## 4. Integrator quickstart

Everything from here is for the developer embedding ChatKonect. You need two things from the
operator: an **App ID** and an **App secret**.

Base URL for all platform calls: `https://<chatkonect-host>/api/v1/platform`

### Step 0 — verify your credentials

```bash
curl https://<host>/api/v1/platform/whoami \
  -H "X-CC-App-Id: app_c2131fcf274bc829" \
  -H "Authorization: Bearer $APP_SECRET"
```

```json
{
  "success": true,
  "app": {
    "appId": "app_c2131fcf274bc829",
    "name": "test1",
    "features": ["chat", "groups", "presence", "typing", "receipts", "reactions", "attachments"],
    "limits": { "maxUsers": 10000, "userTokenMinutes": 60 },
    "active": true
  }
}
```

One call tells you the credentials work, which capabilities you have, and your limits. Use
`features` to decide what UI to render — but never as a security boundary; the server enforces
independently.

### Step 1 — provision a user (from your backend)

Do this once per user, or on every login — it is **idempotent** on `externalId`.

```bash
curl -X POST https://<host>/api/v1/platform/users \
  -H "X-CC-App-Id: app_c2131fcf274bc829" \
  -H "Authorization: Bearer $APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"externalId":"your-user-42","name":"Ada Lovelace"}'
```

`externalId` is **your** primary key for that person. You never have to store a ChatKonect ID —
address users by the ID you already have.

```json
{ "success": true, "created": true,
  "user": { "id": "6a5b…", "externalId": "your-user-42", "name": "Ada Lovelace",
            "avatar": "", "bio": "", "createdAt": "2026-08-12T09:14:22.104Z" } }
```

`created` is `true` on first call (**201**) and `false` on every repeat (**200**) — safe to call on
each login without checking first.

### Step 2 — mint a user token (from your backend)

```bash
curl -X POST https://<host>/api/v1/platform/tokens \
  -H "X-CC-App-Id: app_c2131fcf274bc829" \
  -H "Authorization: Bearer $APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"externalId":"your-user-42"}'
```

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "expiresInSeconds": 3600,
  "user": { "id": "6a5b…", "externalId": "your-user-42", "name": "Ada Lovelace" },
  "features": ["chat", "groups", "presence", "typing", "receipts", "reactions", "attachments"]
}
```

Expose this behind **your own** authenticated endpoint — something like
`GET /my-app/chat-token`, which checks your session and then calls the above server-to-server.
Your frontend calls your endpoint; your app secret never leaves your backend.

### Step 3 — use the token from the browser

The minted token is an **ordinary ChatKonect access token**. There is no special embed API: every
protected REST route and the Socket.IO handshake accept it unchanged.

```js
// REST
const res = await fetch(`${HOST}/api/chats`, {
  headers: { Authorization: `Bearer ${token}` },
});

// Realtime
import { io } from 'socket.io-client';
const socket = io(HOST, { auth: { token } });
```

From here the whole documented API is available to that user — see
[API.md](API.md) for all 158 endpoints and [SOCKET_EVENTS.md](SOCKET_EVENTS.md) for every realtime
event.

### Step 4 — refresh before expiry

**The browser is deliberately never given a refresh token.** The underlying session row is created
with the usual 30-day life but pulled back to your tenant's window, and only the short access token
is handed out — so a leaked token dies in minutes instead of lasting a month.

That means **your frontend cannot refresh itself.** Re-mint through your own endpoint before
`expiresInSeconds` runs out:

```js
// Re-mint at 80% of the token's life. On a 60-minute token that is every 48 minutes.
let token = await getTokenFromMyBackend();
setInterval(async () => { token = await getTokenFromMyBackend(); },
            0.8 * expiresInSeconds * 1000);
```

If you skip this, requests start failing with **401** the moment the token expires.

---

## 5. Platform API reference

All endpoints are under `/api/v1/platform` and require app-secret auth.

**Headers on every call:**

```
X-CC-App-Id: app_c2131fcf274bc829
Authorization: Bearer cc_sk_…
```

The secret may alternatively be sent as `X-CC-App-Secret: cc_sk_…`. Both are accepted; the Bearer
form is preferred.

| Method | Path | Body / query | Success |
|---|---|---|---|
| `GET` | `/whoami` | — | `200` `{ app: { appId, name, features, limits, active } }` |
| `POST` | `/users` | `{ externalId, name, avatar?, bio? }` | `201` created / `200` existing |
| `GET` | `/users` | `?limit=50` (max 200) | `200` `{ count, users[] }`, newest first |
| `DELETE` | `/users/:externalId` | — | `200` — **suspends**, does not delete |
| `POST` | `/tokens` | `{ externalId }` | `200` `{ token, expiresInSeconds, user, features }` |

### Field rules

| Field | Rule |
|---|---|
| `externalId` | Required. String, up to 128 characters. Your own user ID. |
| `name` | Required on `POST /users`. String. |
| `avatar`, `bio` | Optional. |
| `limit` | `GET /users` only. Default 50, capped at 200. |

### Errors

| Status | When | Message |
|---|---|---|
| `400` | Missing/oversized `externalId`, or missing `name` | `externalId is required (a string, up to 128 characters).` |
| `401` | Headers absent | `Send X-CC-App-Id and your app secret as a Bearer token.` |
| `401` | App ID not found | `Unknown app.` |
| `401` | Secret does not match | `Invalid app secret.` |
| `403` | App disabled by the operator | `This app is disabled.` |
| `403` | End user suspended | `This user is not active.` |
| `403` | Capability not granted | `The "<feature>" feature is not enabled for this app.` |
| `404` | Minting a token for an unprovisioned user | `No such user for this app. Provision them first.` |
| `429` | Seat limit reached | `This app has reached its provisioned-user limit.` |

Secrets are compared as SHA-256 digests with a timing-safe comparison, so a wrong secret takes the
same time to reject regardless of how much of it was right.

### Deactivating a user

`DELETE /users/:externalId` **suspends** rather than deletes. Deleting the account would orphan every
message they ever sent and break the history for everyone else in those conversations. Their messages
stay readable to the people they talked to.

Unlike disabling a whole app (§9.4), suspending a user **takes effect immediately for tokens already
issued**: it bumps the user's `tokenVersion`, which invalidates every access token outstanding for
them. This is the real per-user kill switch.

> **There is no un-suspend endpoint.** `POST /users` with the same `externalId` updates the name,
> avatar and bio but does **not** clear `accountStatus` — the user stays suspended and token minting
> keeps returning `403 This user is not active.` Reactivating currently requires an operator to flip
> `accountStatus` back to `active` directly (admin console / database). Treat `DELETE` as
> close-to-permanent until that gap is closed.

---

## 6. What an end user can and cannot do

A user token is a normal user session inside one tenant. So:

- **Can** — start 1:1 chats, create groups, upload attachments, react, get presence and typing and
  receipts, use calls/meetings/status if those flags are on.
- **Cannot** — see or search any user outside their own App. Cross-tenant reachability is filtered
  at the query level (`tenantScope()`), so there is no request that returns another tenant's users.
- **Cannot** — reach the admin console, tenant management, or the platform API. Those need either a
  first-party admin session or the app secret.

Two users of the same App must still become contacts before a 1:1 chat opens — the same mutual-accept
rule that applies to first-party users (`Send a contact request and get accepted before you can
chat.`). Provisioning two users does not automatically connect them; wire your product's own
relationships into contact requests.

### Group audio and video calls

Group calling is **fully available to a tenant** — it is the same code path first-party users get,
not a reduced one. Verified end-to-end by `server/tests/platform-calls.mjs`:

- A **minted user token authenticates the Socket.IO handshake**, so a tenant's users get the full
  signalling channel, not just REST.
- A tenant user creates a group (`POST /api/groups`) and starts a group call
  (`POST /api/calls` with `chatId`, `isGroup: true`, `type: 'audio' | 'video'`).
- **Every member rings** — each gets `call:incoming` — and the ring carries the **group identity**
  (`isGroup: true` plus `group: { _id, name, avatar, memberCount }`), so your UI can show
  "Acme Support is calling" exactly as the first-party client does.
- Two members who are **not contacts** can still exchange SDP offers and ICE candidates. Group
  membership authorises the call leg; the mutual-contact rule above applies to 1:1 calls only.

Two flags gate it, and both are genuinely enforced: **`calls`** (a tenant without it gets `403` from
`POST /api/calls`, with a message naming the feature) and **`groups`**. `video` is *not* separately
enforced — video rides the `calls` router (§9.1), so `calls` is the switch that matters.

Isolation holds on this path: a `call:invite` aimed at a user of a **different** tenant is dropped,
so cross-tenant ringing is impossible.

**1:1 calls work the same way, with no Call record required.** The authorization on
`call:offer` / `call:answer` / `call:ice-candidate` is `canCallSignal` = mutual
contacts **or** shared group **or** `inSameCall`. For two contacts the first branch
passes, so a raw socket emit relays with **no `callId` and no pre-existing Call
record** — `POST /api/calls/start` is for history and the offline push, not a
prerequisite for signalling. The same handler serves every client; there is no
separate first-party path.

> ⚠ **The target field is `to`, not `receiverId`.** `receiverId`/`callType` are REST
> fields for `POST /api/calls/start`. On the socket, `{ receiverId, offer }` leaves
> `to` undefined and the emit is dropped **silently** — no error, no log. And
> `typing-start`/`typing-stop` are chat-room scoped: both sides must emit `join-chat`
> first, and typing cannot be aimed at a user id. See
> [SOCKET_EVENTS.md §2](SOCKET_EVENTS.md).

### Group endpoints — the four that get addressed wrongly

Each of these returns a success status when addressed with the wrong key or route,
so the mistake looks like a missing feature. Verified in both directions by
`server/tests/embed-groups.mjs` (22 checks).

| Goal | Correct call | The near-miss, and what it does |
|---|---|---|
| Create a group with members | `POST /api/groups` `{ name, members: [ids] }` | `participants:` or `userIds:` → **201 with only the creator**. `members` is the only key read |
| Add members later | `POST /api/groups/:id/members` `{ members: [ids] }` | `PATCH /api/groups/:id` → **200, member count unchanged**. That route is `updateGroup`; it assigns only `name`/`description`/`avatar`/`messagingPolicy` |
| Rename / re-avatar a group | `PATCH /api/groups/:id` `{ name }` | — (works as documented) |
| Start a group call | `POST /api/calls` `{ type, chatId, isGroup: true, participants: [ids] }` | `POST /api/calls/start` → **400**, it is the 1:1 endpoint (`receiverId` + mutual contacts) |

Two things that make groups cheaper than 1:1 for a partner: **no contact handshake
is required** to add someone to a group (`groupAddPermission` defaults to
`everyone`), and **group membership alone authorises the mesh legs**, so members who
aren't contacts can signal each other. Check the `skipped[]` array in the response —
it names anyone omitted with a reason (`not_found`, `blocked`, `privacy`).

### TURN is bring-your-own

There is **no TURN server in this project and no endpoint that issues TURN
credentials** — the server never touches ICE at all. `VITE_TURN_*` is a build-time
variable for the first-party React client only; it has no bearing on a partner
frontend, which must configure its own `RTCPeerConnection` `iceServers`.

STUN alone (what `client/src/lib/iceServers.js` ships) covers same-LAN and most
home networks and fails on mobile carriers, corporate wifi and symmetric NAT —
where the call rings, "connects", and carries no media. A relay is required for
production.

**Do not ship static TURN credentials to a browser.** They are readable by anyone
who opens devtools and can be used to relay arbitrary traffic at your expense. Mint
short-lived credentials server-side instead — the coturn REST-API scheme
(`TURN_REST_API` shared secret → HMAC username/password pairs) is the standard, and
hosted providers expose the same shape. `iceServers.js` already supports it via
`VITE_TURN_CREDENTIALS_URL`: an endpoint returning one ice-server object or an
array. Copy that pattern.

Two things you must supply yourself:

1. **The call UI and the `RTCPeerConnection` wiring.** The drop-in embed (§10) renders calls for you; this applies only if you are building your own frontend (§9.2). The server
   relays signalling; creating peer connections, attaching tracks and rendering tiles is your
   frontend's job. `client/src/hooks/useWebRTC.js` is a working reference implementation.
2. **TURN credentials.** Calls are peer-to-peer full mesh. Without a TURN server, any two users
   behind symmetric NAT will fail to connect — see [SCALING_CALLS.md](SCALING_CALLS.md). Mesh is
   comfortable to ~6 participants and hard-capped at 9; beyond that use meetings with LiveKit.

---

## 7. Security rules

1. **The app secret is backend-only.** Never in frontend code, a mobile binary, a public env var, or
   a committed file. Anyone holding it can mint a token for *any* user in your tenant.
2. **Mint tokens behind your own auth.** Your token endpoint must verify your own session first;
   otherwise it is an open door to impersonate any `externalId`.
3. **Keep the lifetime short.** 60 minutes is the default; 15–30 is better for sensitive products.
   Re-minting is one server-to-server call.
4. **Rotate on any suspicion**, and after staff turnover. Rotation is immediate and breaks the old
   secret, so schedule a deploy alongside it.
5. **Treat `features` from the API as UI hints only.** The four enforced flags are enforced
   server-side; the rest are not (§9.1). Do not build a paywall on the unenforced ones.

---

## 8. End-to-end example

A minimal Express backend exposing exactly one endpoint to its own frontend:

```js
// server-side only — APP_SECRET never leaves this process
const HOST = process.env.CHATKONECT_HOST;   // https://chat.example.com
const APP_ID = process.env.CHATKONECT_APP_ID;
const APP_SECRET = process.env.CHATKONECT_APP_SECRET;

const ccHeaders = {
  'X-CC-App-Id': APP_ID,
  Authorization: `Bearer ${APP_SECRET}`,
  'Content-Type': 'application/json',
};

app.get('/my-app/chat-token', requireMyOwnLogin, async (req, res) => {
  const me = req.user;                        // YOUR user, from YOUR session

  // Idempotent: safe on every call, keeps name/avatar in sync.
  await fetch(`${HOST}/api/v1/platform/users`, {
    method: 'POST',
    headers: ccHeaders,
    body: JSON.stringify({ externalId: me.id, name: me.fullName, avatar: me.photoUrl }),
  });

  const r = await fetch(`${HOST}/api/v1/platform/tokens`, {
    method: 'POST',
    headers: ccHeaders,
    body: JSON.stringify({ externalId: me.id }),
  });
  if (!r.ok) return res.status(502).json({ error: 'chat unavailable' });

  const { token, expiresInSeconds, features } = await r.json();
  res.json({ token, expiresInSeconds, features, host: HOST });   // note: no secret
});
```

Frontend:

```js
const { token, host, expiresInSeconds } = await (await fetch('/my-app/chat-token')).json();

const chats = await (await fetch(`${host}/api/chats`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();

const socket = io(host, { auth: { token } });
socket.on('receive-message', (m) => console.log('new message', m));

// Re-mint before it expires — the browser cannot refresh on its own.
setTimeout(refreshChatToken, 0.8 * expiresInSeconds * 1000);
```

---

## 9. Known gaps

These are real limitations in the current build, not documentation shortcuts. They are listed here
because promising them to a customer would be promising something that does not work yet.

### 9.1 Nine of the thirteen capability toggles are not enforced

Only `groups`, `calls`, `meetings` and `status` have a server-side gate
(`requireFeature` on their routers). The other nine — `chat`, `video`, `presence`, `typing`,
`receipts`, `reactions`, `attachments`, `voiceNotes`, `push` — are stored and displayed, but nothing
checks them. **Turning them off in the console changes nothing.**

Practical consequences:

- Switching **Voice notes**, **Attachments** or **Web push** off does not stop a tenant using them.
- Switching **Video calls** off does not block video: video rides the `calls` router, so only the
  `calls` flag actually gates it.

*To close it:* add `router.use(requireFeature('<flag>'))` to the relevant routers
(`messageRoutes`, `uploadRoutes`, `pushRoutes`, …) — the helper already exists and already handles
first-party users correctly. Until then, treat the nine as labels.

### 9.2 Two integration modes, and only one of them is drop-in

**Mode A — drop-in embed (§10).** The whole UI in an iframe, authenticated by your
own login. You write no chat code. This is the recommended path and what most
integrators should use.

**Mode B — build your own frontend.** Full REST + Socket.IO access
([API.md](API.md), [SOCKET_EVENTS.md](SOCKET_EVENTS.md)). Total control, and you own
every screen, the WebRTC wiring and your own ICE configuration.

What Mode B does *not* have is a component library: there is no published package
that renders individual ChatKonect pieces (a message list, a composer) inside your
own layout. It is the whole UI in a frame, or your own UI against the API. A
half-way option would mean shipping our React tree into your bundle, where it would
fight your React version, your Tailwind preflight and your global CSS in every host
it lands in.

`@chatkonect/react` (in `packages/react/`) is a thin wrapper around the iframe
loader, not a component library — it exists so a React host does not have to manage
script injection by hand.

### 9.3 `allowedOrigins` — now enforced

Previously stored and never read. It is now the source of truth for two things:

- **Who may embed.** `GET /api/v1/embed/config` rejects a `parentOrigin` that isn't
  registered. Checked against the *parent* origin, not the iframe's own — an XHR
  from inside the frame carries our origin, so a header-only check compared the
  value against ourselves and could never fail.
- **CORS and CSRF.** A registered origin is accepted without an operator adding it
  to the global `EXTRA_CORS_ORIGINS` and redeploying. That per-partner env edit was
  the single biggest reason self-service integration did not work.

An empty list still means "any origin" for that tenant, so this only ever widens
access for tenants that chose to pin. Pin yours before production.

Origin is forgeable outside a browser, so treat this as an integration guard rather
than a security boundary. The boundary is that a user token speaks for exactly one
end user, and only your backend can mint one.

### 9.4 Disabling an app does not end live sessions

`active: false` blocks new platform calls immediately, but already-minted user tokens keep working
until they expire — they are ordinary access tokens and are not re-checked against the app's status.
With the default 60-minute lifetime, that is up to an hour of residual access. Shorten
`userTokenMinutes` if you need a tighter kill switch.

Note the asymmetry: suspending a **single user** *is* immediate (it bumps their `tokenVersion`), but
disabling a **whole app** is not. To cut a tenant off instantly today you would have to suspend its
users individually.

### 9.5 A suspended end user cannot be reactivated through the API

`DELETE /users/:externalId` sets `accountStatus: 'suspended'`, and no platform endpoint sets it back —
`POST /users` deliberately only syncs name/avatar/bio on an existing user. Reactivation needs
operator intervention outside the platform API.

---

## 10. Drop-in embed — the whole UI, your login

The fastest integration, and the one that removes every class of error the raw API
path exposes. You supply a user token; ChatKonect supplies the product.

```html
<div id="chat" style="height:600px"></div>
<script src="https://chat.example.com/embed.js"></script>
<script>
  const chat = ChatKonect.mount({
    el: '#chat',
    appId: 'app_7f3c9a2b4d1e',
    // Called on mount AND again before expiry, so sessions never visibly drop.
    // Point it at YOUR endpoint, behind YOUR session (see §8).
    getToken: () => fetch('/my-app/chat-token').then((r) => r.json()).then((d) => d.token),
    onReady: (user) => console.log('chat ready', user),
    onError: (err) => console.error(err.code, err.message),
  });

  chat.navigate('/calls');   // drive the embedded UI
  chat.refreshToken();       // push a fresh token immediately
  chat.destroy();            // remove it
</script>
```

React hosts can use `packages/react/` instead:

```jsx
<ChatKonect host="https://chat.example.com" appId="app_…" getToken={getToken} style={{ height: 600 }} />
```

### What you no longer configure

| Previously your problem | Now |
|---|---|
| API base URL | Resolved by `GET /api/v1/embed/config` |
| Socket.IO URL and path | Same |
| Which features are on | Same — the embed hides surfaces your app isn't granted |
| A TURN relay | `GET /api/v1/embed/ice` mints time-limited coturn credentials from the operator's relay |
| The entire UI | Rendered by us |
| Signalling contracts (`to` vs `receiverId`, the `join-chat` argument shape, `call:end` vs `call:ended`) | Not yours to get wrong any more |

### Security properties

- **The token is never in the URL.** Query strings land in browser history, server
  access logs and the `Referer` header. It arrives by `postMessage` from your
  declared origin only.
- **The frame renders nothing without a token.** A pre-existing first-party session
  in `localStorage` is deliberately *not* enough, so a hostile page that frames
  `/embed` gets an idle "Connecting…" screen and no session.
- **Origins are verified twice**: the frame compares every message origin with
  strict equality against its declared `parentOrigin`, and the server checks that
  origin against `allowedOrigins` (§9.3).
- **No refresh token reaches the browser.** Rotation goes through your backend, the
  only holder of the app secret. The embed asks for one via `token-expiring` at 80%
  of the token lifetime.
- **Admin surfaces are absent by construction** — the embed's route table has no
  `/admin`, `/developers` or `/platform` entry to reach.

### Operator setup

| Variable | Why |
|---|---|
| `EMBED_URL` | Origin serving the UI. A wrong value is why a host page frames a 404. |
| `TURN_URL` + `TURN_SECRET` | coturn in `use-auth-secret` mode. Unset = STUN only, and calls fail between strict/symmetric NATs. |
| `API_PUBLIC_URL` | Only when a proxy rewrites Host and the derived origin comes out wrong. |

The frontend host must allow framing on `/embed` **only**. `client/vercel.json` does
this: `frame-ancestors *` on `/embed` and `/embed/*`, `'none'` everywhere else, so
the main app still cannot be clickjacked. On another host, replicate that split — a
blanket `X-Frame-Options: DENY` silently blocks the entire embed.

Verified by `server/tests/embed-dropin.mjs` (29 checks) and
`client/audit-embed-protocol.mjs`.

---

## See also

- [API.md](API.md) — the 158 REST endpoints a user token can reach
- [SOCKET_EVENTS.md](SOCKET_EVENTS.md) — realtime events and call-signaling sequences
- [AUTHENTICATION.md](AUTHENTICATION.md) — how access tokens and sessions work underneath
- [ENVIRONMENT.md](ENVIRONMENT.md) — resolving the correct host per environment
- [DATABASE_MODELS.md](DATABASE_MODELS.md) — the `App` schema and tenant fields on `User`

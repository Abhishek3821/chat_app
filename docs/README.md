# ChatKonect — Documentation

Backend + realtime documentation for the ChatKonect server. Every fact in these documents was
extracted directly from the source (`server/`, `client/src/`) and cross-checked against the
route/model/socket definitions — nothing here is guessed. Where the code and a doc ever disagree,
the code wins; please open an issue (or fix the doc) if you find a drift.

## Start here

| Doc | What it covers |
|---|---|
| [**API.md**](API.md) | Full REST reference — **184 endpoints** across 27 routers, generated from source. Method, auth, params, body, exact success/error JSON, side effects. |
| [**AUTHENTICATION.md**](AUTHENTICATION.md) | JWT + session flow: signup, login (email/username/phone), refresh/rotation, logout, RBAC, two-step PIN, Socket.IO handshake auth. |
| [**DATABASE_MODELS.md**](DATABASE_MODELS.md) | All 20 Mongoose schemas — fields, types, defaults, indexes, hooks/methods, and how the models reference each other. |
| [**SOCKET_EVENTS.md**](SOCKET_EVENTS.md) | Every Socket.IO event in both directions, plus the exact call-signaling sequences (accept/reject/cancel/busy/group mesh). |
| [**FILE_UPLOADS.md**](FILE_UPLOADS.md) | Upload endpoints, size/type limits, storage drivers, and how uploaded/protected media is accessed. |
| [**MEETINGS.md**](MEETINGS.md) | The meeting module end to end: model, status lifecycle, the three ways in and the knock/admit gate, REST + socket surface, mesh vs SFU, polls/Q&A/captions/recording, attendance, invitations, and what's stored but not implemented. |
| [**SELF_HOSTED_TURN.md**](SELF_HOSTED_TURN.md) | Run your own coturn relay instead of a managed provider: install, config (including the two mistakes that make it silently useless), verification, bandwidth cost, and how to run a network of relays across regions. |
| [**deploy/turn/**](../deploy/turn/) | The runnable half: a one-command coturn installer, and a prober that performs a real TURN Allocate to prove a relay actually relays (plus its own 25-check self-test). |
| [**SCALING_CALLS.md**](SCALING_CALLS.md) | How many people fit in one call/meeting and why; adaptive mesh encoding; turning on the LiveKit SFU for 10+ rooms. |
- [INTEGRATION.md](INTEGRATION.md) — put ChatKonect chat inside another project (start here)
| [**PLATFORM.md**](PLATFORM.md) | Embedding ChatKonect in another product: App-as-tenant, the app-secret/user-token split, the `/v1/platform` API, capability flags, and the current gaps. **Hand this to an integrating customer.** |
| [**ENVIRONMENT.md**](ENVIRONMENT.md) | Every environment variable actually read by the app — non-secret, by design. Base URL / Socket URL resolution. |
| [**BUSINESS_LOGIC.md**](BUSINESS_LOGIC.md) | Feature flows and the business rules behind them — the "why", not just the "what". |
| [**ARCHITECTURE_REVIEW.md**](ARCHITECTURE_REVIEW.md) | Staff-level review: current topology, findings ranked by blast radius, monolith→services plan, queue design, fault tolerance, and a triggered roadmap. |
| [`../postman/`](../postman/) | A Postman collection + environment. Import both, run Auth → login, and the token is captured for every later request. |

## Quick start for a new integration

1. Read [ENVIRONMENT.md](ENVIRONMENT.md) to find the base URL for your environment.
2. Import [`postman/ChatKonect.postman_collection.json`](../postman/ChatKonect.postman_collection.json)
   and [`postman/ChatKonect.postman_environment.json`](../postman/ChatKonect.postman_environment.json)
   into Postman.
3. Run **Auth → POST login** (or the send-code → verify-code → signup sequence) — the collection's
   test scripts capture `accessToken` automatically for every subsequent request.
4. For realtime features, connect a Socket.IO client per [SOCKET_EVENTS.md](SOCKET_EVENTS.md) §1.
5. For a third-party/server-to-server integration instead of a logged-in user, see
   [API.md → Public API v1](API.md#public-api-v1-apiv1) (`X-API-Key` auth).

## Conventions used throughout

- All request/response bodies are shown as **realistic placeholder JSON**, not schemas — copy them
  directly into a client.
- `SafeUser` / `PublicUser` / `ChatPopulated` / `MessagePopulated` are shared shapes defined once in
  [API.md → Global conventions](API.md#global-conventions) and referenced by name elsewhere to avoid
  repeating the same JSON forty times.
- 🔴 / 🟡 / 🟢 markers in [ENVIRONMENT.md](ENVIRONMENT.md) classify a variable as secret /
  public-by-construction / plain config.
- Every doc that quotes code cites the file (and where practical the line), so you can jump straight
  to the source.

## Known gaps / honesty notes

These were found while writing the docs and are worth knowing about rather than papering over:

- **Some upload validation errors currently return `500`** instead of `400` (unsupported file type,
  file too large) — see [FILE_UPLOADS.md §4](FILE_UPLOADS.md). Treat any `500` from that endpoint as
  a possible validation failure, not only a server fault.
- **Three env vars in `server/.env` are dead code**: `JWT_EXPIRES_IN`, `JWT_COOKIE_EXPIRES_DAYS`,
  `ENABLE_LOGIN_OTP` — see [ENVIRONMENT.md](ENVIRONMENT.md) for what actually governs those behaviours.
- **`Report.status`/target fields have no schema-level index or enforced target consistency** — see
  [DATABASE_MODELS.md → Report](DATABASE_MODELS.md#report).
- The **"global reachability"** design (any user can be found/contacted across workspaces) is
  intentional, not a bug — see [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) for the reasoning.

## Verification

While assembling this documentation:
- Every documented endpoint path was diffed against the actual `router.get/post/patch/put/delete(...)`
  calls in `server/routes/*.js` — **158/158 matched**, zero undocumented, zero invented.
- Every Socket.IO event name mentioned in code (`server/socket/index.js` + all controllers using
  `emitToUser`/`io.to(...).emit`, plus the client hooks) was diffed against `SOCKET_EVENTS.md` —
  **69/69 matched** (the one apparent mismatch, `"failed"`, turned out to be a BullMQ queue-worker
  event, not Socket.IO).
- `ENVIRONMENT.md` was checked to confirm it lists **secret variable names only, never values**.

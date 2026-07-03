# ChatConnect Public API — v1

Integrate ChatConnect (chat, calls, meetings) into another platform. This is
**Phase 1**: API-key auth + a versioned REST surface. Realtime/socket embedding,
external-user provisioning, webhooks and an SDK are planned (see Roadmap).

## Model: a key acts *as its owner*
An API key belongs to a ChatConnect user and **acts on behalf of that user**,
limited to the **scopes** you grant it. Every v1 endpoint runs the exact same,
already-secured controller the app uses — so a key can never reach data its
owner couldn't (e.g. it can only message chats the owner is a participant of).

## 1. Get a key
Create keys while logged in — either in the app (**Settings → Developer / API
keys**) or via the management API using your session:

```bash
curl -X POST https://chat-app-zqj9.onrender.com/api/keys \
  -H "Authorization: Bearer <YOUR_SESSION_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"label":"My integration","scopes":["chat:read","chat:write","contacts:read"]}'
# → { "key": "cc_live_XXXXXXXX…", "id": "...", "scopes": [...] }
```

The secret (`cc_live_…`) is returned **once** — store it securely. Only its
hash is kept server-side. Manage keys: `GET /api/keys`, `DELETE /api/keys/:id`.

## 2. Authenticate
Send the key on every v1 request:

```
X-API-Key: cc_live_XXXXXXXX…
```

- Base URL: `https://chat-app-zqj9.onrender.com/api/v1`
- Rate limit: **120 requests / minute per key** (HTTP 429 over the limit).
- Errors: `{ "success": false, "message": "..." }` with `401` (bad/missing key),
  `403` (missing scope / not allowed), `404`, `429`.

## 3. Scopes
| Scope | Grants |
|-------|--------|
| `chat:read` | list chats, read messages |
| `chat:write` | open direct chats, send messages |
| `contacts:read` | list contacts, search users |
| `calls:write` | start calls |
| `meetings:read` | list meetings |
| `meetings:write` | schedule meetings |

## 4. Endpoints

| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| GET | `/me` | — | The key's owner + granted scopes (health check) |
| GET | `/contacts` | `contacts:read` | The owner's contacts |
| GET | `/users/search?q=` | `contacts:read` | Find users by name/username/email |
| GET | `/chats` | `chat:read` | The owner's conversations |
| POST | `/chats/direct/:userId` | `chat:write` | Get-or-create a 1:1 chat (must be mutual contacts) |
| GET | `/messages/:chatId` | `chat:read` | Messages in a chat (owner must be a member) |
| POST | `/messages` | `chat:write` | Send a message |
| POST | `/calls` | `calls:write` | Start a call (rings the participants) |
| GET | `/meetings` | `meetings:read` | The owner's meetings |
| POST | `/meetings` | `meetings:write` | Schedule a meeting |

### Examples

```bash
# Who is this key?
curl https://chat-app-zqj9.onrender.com/api/v1/me -H "X-API-Key: $KEY"

# Send a message
curl -X POST https://chat-app-zqj9.onrender.com/api/v1/messages \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"chatId":"<CHAT_ID>","content":"Hello from our platform 👋"}'

# Open a 1:1 chat then message it
curl -X POST https://chat-app-zqj9.onrender.com/api/v1/chats/direct/<USER_ID> -H "X-API-Key: $KEY"

# Schedule a meeting
curl -X POST https://chat-app-zqj9.onrender.com/api/v1/meetings \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Kickoff","startAt":"2026-07-10T15:00:00Z","type":"video","participants":["<USER_ID>"]}'
```

## Security notes
- Keys are stored only as SHA-256 hashes; the plaintext is shown once.
- All app-level authorization still applies (contact gates, chat membership,
  status privacy). The key cannot exceed its owner's permissions or its scopes.
- Revoke a leaked key immediately (`DELETE /api/keys/:id`) — it stops working at once.
- Never embed a `cc_live_…` key in client-side/browser code; use it from your server.

## Roadmap (later phases)
- **Realtime**: short-lived socket tokens to embed live chat + WebRTC calls.
- **External users**: provision/link a partner platform's users and mint scoped
  per-user tokens (so their end-users authenticate without your session).
- **Webhooks**: signed outbound events (`message.created`, `call.ended`, …).
- **SDK / embed**: a drop-in JS widget for chat and calls.

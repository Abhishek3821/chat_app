# Socket.IO Event Documentation

Every realtime event, in both directions, plus the exact ordering of WebRTC call signaling.

- **Socket URL (dev):** `http://localhost:5000` — the client connects *directly* to the backend, not
  through Vite's proxy (see §1).
- **Socket URL (prod):** same origin as the app.
- **Related:** [AUTHENTICATION.md](AUTHENTICATION.md#110-socketio-handshake-authentication) ·
  [API.md](API.md) · [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)

## 1. Connection & handshake

### URL resolution (client)

`resolveSocketUrl()` in `client/src/hooks/useSocket.js:53`:

1. `VITE_SOCKET_URL` if set → used verbatim.
2. Else if `VITE_API_URL` is absolute (`^https?://`) → its origin, with a trailing `/api` stripped (`api.replace(/\/api\/?$/, '')`).
3. Else in dev → `${window.location.protocol}//${window.location.hostname}:5000` (deliberately bypasses the Vite `/socket.io` proxy, which makes the WS upgrade flaky).
4. Else (`prod`, no env) → `undefined` = same-origin.

Path is the Socket.IO default `/socket.io` (never overridden on either side).

### Client options

```js
io(url, {
  auth: (cb) => cb({ token: localStorage.getItem('cc_token') }), // dynamic: re-read on every (re)connect
  withCredentials: true,
  transports: ['websocket', 'polling'],  // native WS preferred, polling only as fallback
})
```

The socket is created once per authenticated `user._id` (keyed on the id, not the user object, so a profile edit doesn't tear down an in-progress call) and stashed on `window.__ccSocket` — `emitSocket(event, payload)` (`useSocket.js:258`) and `getSocket()` in the call/meeting hooks read it from there.

### Server options

`server/server.js:109`:

```js
const io = new SocketServer(server, { cors: { origin: corsOrigin, credentials: true } });
```

`corsOrigin` delegates to `isAllowedOrigin()` (`server/middleware/csrf.js:14`): `CLIENT_URL` + `EXTRA_CORS_ORIGINS`, plus any `localhost`/`127.0.0.1`/LAN-IP origin when `NODE_ENV !== 'production'`. A disallowed origin is *declined* (no throw / no 500).

When `REDIS_URL` is set, `@socket.io/redis-adapter` is attached (`server.js:116-122`) and `initSocket(io, { hasAdapter: true })` — that flag is what makes `isUserOnline()` able to ask other instances via `io.in('user:<id>').fetchSockets()`.

### Auth payload shape & handshake middleware

`io.use()` at `server/socket/index.js:131`:

- Token read from `socket.handshake.auth.token` **or** `socket.handshake.headers.authorization.split(' ')[1]` (i.e. `Authorization: Bearer <access token>` also works).
- `verifyToken(token)` → `jwt.verify(..., { algorithms: ['HS256'] })`.
- **Scoped tokens are rejected**: `if (decoded.scope) return next(new Error('Invalid auth token'))` — the media token (`scope: 'media'`) and the meeting pass (`scope: 'meet-admit'`) can never open a socket.
- Loads `User.findById(decoded.id).select('accountStatus tokenVersion privacy name avatar email')`.
- Rejects when: user missing, `accountStatus !== 'active'`, `decoded.tokenVersion !== user.tokenVersion`, no `decoded.sid`, or the `Session` is invalid/`revokedAt`/expired/belongs to another user.

Exact failure messages: `No auth token`, `Invalid auth token`, `User no longer exists`, `Account is not active`, `Session revoked`, `Invalid session`.

On success the middleware stamps:

| Property | Value |
|---|---|
| `socket.userId` / `socket.data.userId` | `String(user._id)` |
| `socket.userName` / `socket.data.name` | `user.name` |
| `socket.userAvatar` / `socket.data.avatar` | `user.avatar` |
| `socket.userEmail` / `socket.data.email` | `user.email` |
| `socket.readReceipts` | `user.privacy?.readReceipts !== false` |

(`socket.data.*` duplicates exist so `adapter.fetchSockets()` can build meeting rosters cross-instance.)

### What happens on auth failure

Server calls `next(new Error(...))` → client gets `connect_error`. The client handler (`useSocket.js:101`) refreshes the access token **once** (`refreshAccessToken()`), guarded by a `refreshedForAuth` flag to prevent a loop, then calls `socket.connect()`. If the refresh fails, the socket stays down (no retry storm).

### Rooms joined

| Room | When | Gate |
|---|---|---|
| `user:<userId>` | Immediately on `connection` (`socket.join('user:'+userId)`) | none — implied by the authenticated handshake. All `emitToUser()` fan-out targets this room, so every tab/device of a user receives it |
| `chat:<chatId>` | On the `join-chat` event | **Only after** `isChatMember(chatId, userId)` — `Chat.findOne({_id, 'participants.user': userId})`. Room membership then doubles as the authorization check for typing/reaction/read relays (`inChat()`) |
| `mtg:<meetingId>` | On `meeting:join`, after the meeting/host/admission checks pass | see `meeting:join` row below. Also records `socket.data.meetings` (Set), `socket.data.meetingHost[meetingId]` (bool), `socket.data.meetingJoinAt[meetingId]` (ms) |

Ordering note (`socket/index.js:176`): **all** listeners are registered synchronously before any `await`, because clients emit `join-chat` the instant they connect; presence bookkeeping is deliberately done *last* (`:659`).

### Presence lifecycle

- On connect (after listeners): `onlineUsers: Map<userId, Set<socketId>>` updated; `socket.emit('presence-snapshot', { online: [...userIds] })` to the connecting socket only; if this was the user's first socket → `setPresence(userId, true)` (DB) + `socket.broadcast.emit('user-online', { userId })`.
- On `disconnect`: end live call legs (see call sequences), emit `meeting:peer-left` into every meeting room this socket was in + `finalizeAttendance()`, remove socketId; if the user's set becomes empty **and** `isUserOnline()` says they're gone on every instance → `setPresence(false)` + `socket.broadcast.emit('user-offline', { userId, lastSeen })`.

### Reconnect behaviour (client)

`connect` fires again → server-side rooms are gone. `useSocket.js:90` re-emits `join-chat` for `activeChatId` and calls `useChat.getState().resync()`. `useMeetingRoom.js:285` tears down the whole stale mesh and re-joins as a newcomer (its old socket id is dead).

---

## 2. Client → Server events

All handlers live in `server/socket/index.js`. `isId(v)` = `typeof v === 'string' && mongoose.isValidObjectId(v)` (socket payloads never pass through the Express `mongoSanitize`, so any id used in a query is validated here).

| Event | Payload | Who may emit | Effect / what the server does | What it emits back |
|---|---|---|---|---|
| `join-chat` | `chatId` (raw string, not an object) | any authenticated socket | `isChatMember()` → `socket.join('chat:'+chatId)`. Silent no-op if not a member | nothing |
| `leave-chat` | `chatId` | any | `socket.leave('chat:'+chatId)` (no validation needed) | nothing |
| `typing-start` | `{ chatId }` | socket already in `chat:<id>` | relay only | `typing-start` `{ chatId, userId }` → `socket.to('chat:'+chatId)` (excludes sender) |
| `typing-stop` | `{ chatId }` | in-room | relay only | `typing-stop` `{ chatId, userId }` → chat room, sender excluded |
| `message-read` | `{ chatId, messageIds }` | in-room | pure relay, **no DB write** (legacy path; the current client never emits this and never listens for it) | `message-read` `{ chatId, messageIds, userId }` → chat room, sender excluded |
| `message-reaction` | any object containing `chatId` (relayed verbatim) | in-room | pure relay; persistence happens over REST `POST /api/messages/:id/react` | `message-reaction` (same payload) → chat room, sender excluded |
| `message:delivered` | `{ chatId, messageId }` | must be a chat member; `isId(messageId)` required | `Message.updateOne({_id: messageId, chat: chatId, sender: {$ne: me}, deliveredTo: {$ne: me}}, {$addToSet:{deliveredTo: me}})` | only if `modifiedCount` → `message:status` `{ chatId, messageId, userId, status:'delivered' }` to the **whole** `chat:<id>` room (`emitToChat`, includes sender) |
| `message:read` | `{ chatId }` | must be a chat member | `Message.updateMany({chat, sender:{$ne:me}, 'readBy.user':{$ne:me}}, {$push:{readBy:{user:me, at:now}}})` — marks the whole conversation read in one shot | only if `modifiedCount` **and** `socket.readReceipts` → `message:read` `{ chatId, userId }` to `chat:<id>`. Reads are always recorded; suppression only hides them from the sender |
| `register-user` | `(cb)` — an ack callback (test suites pass `{userId}` as arg 1) | any | no-op; presence is keyed off the JWT handshake | ack `cb({ ok: true, userId })` |
| `call:invite` / `call-user` | `{ to, callId, type\|callType, caller, chatId? }` | **contact-gated**: `canSignal(me,to,chatId)` = mutual contacts **OR** both members of the same *group* chat | if `!(await isUserOnline(to))` → log `missed` and bail. Else `trackPeer(to,callId)`, `registerCallInvitee(callId, me, to)` (pushes the invitee onto `Call.participants` — this is what later authorizes *their* legs to every conference member) | to callee: `call:incoming` **and** `incoming-call` `{ from, callId, type, caller, chatId, isGroup: !!chatId }`. If offline: `call:unavailable` `{ callId, to }` back to the **caller only** (`socket.emit`) |
| `call:introduce` | `{ to, callId, peer: {_id,name,avatar} }` | requires `inSameCall(callId, me, to)` — both already on the Call record. Contacts are **not** required | relay only | `call:introduced` `{ from, callId, peer:{_id,name,avatar} }` to `to` |
| `call:accept` / `accept-call` | `{ to, callId, chatId? }` | `canCallSignal(to, chatId, callId)` = `canSignal(...) \|\| inSameCall(...)` | `transitionCall(callId, me, 'accept')` → `status:'accepted'`, `answeredAt`, participant `joined` (only from `ringing`); `trackPeer` | `call:accepted` **and** `accept-call` `{ from, callId, chatId }` to `to`; **plus** `call:handled` `{ callId }` to the accepter's *other* sockets (`socket.to('user:'+me)`) to close duplicate ringing popups |
| `call:reject` / `reject-call` | `{ to, callId, chatId? }` | gate applies to the *relay* only — `transitionCall` runs first, unconditionally | `transitionCall(..., 'reject')` → `status:'rejected'`, `endedAt`; `untrackPeer(to)` | `call:rejected` **and** `reject-call` `{ from, callId }` to `to` (if gate passes); `call:handled` `{ callId }` to own other tabs |
| `call:busy` | `{ to, callId, chatId? }` | gate on relay only | `transitionCall(..., 'missed')` | `call:busy` `{ from, callId }` to `to` |
| `call:screen` | `{ to, callId, chatId?, on }` | `canCallSignal` | relay only | `call:screen` `{ from, callId, on: !!on }` |
| `call:offer` / `webrtc-offer` | `{ to, offer, callId, chatId? }` | `canCallSignal` (this is the second, media-negotiation gate) | `trackPeer(to, callId)` (covers mesh legs that never sent an invite) | `call:offer` **and** `webrtc-offer` `{ from, offer, callId, chatId }` |
| `call:answer` / `webrtc-answer` | `{ to, answer, callId, chatId? }` | `canCallSignal` | `trackPeer` | `call:answer` **and** `webrtc-answer` `{ from, answer, callId, chatId }` |
| `call:ice-candidate` / `webrtc-ice-candidate` | `{ to, candidate, callId, chatId? }` | `canCallSignal` | relay only (SDP/ICE are opaque to the server) | `call:ice-candidate` **and** `webrtc-ice-candidate` `{ from, candidate, callId, chatId }` |
| `call:cancel` / `call-missed` | `{ to, callId, chatId? }` | gate on relay only | `transitionCall(..., 'missed')`; `untrackPeer` | `call:cancelled` **and** `call-missed` `{ from, callId }` |
| `call:end` / `end-call` | `{ to, callId, duration?, chatId? }` | gate on relay only | `transitionCall(..., 'end', {duration})` → `completed` (+duration) if it was live, else `missed`; `untrackPeer` | `call:ended` **and** `call-ended` `{ from, callId }` |
| `meeting:join` | `({ meetingId, pass? }, cb)` | any authenticated socket — link-sharing is the point. `isId(meetingId)` required | Loads `Meeting.findById().select('status host settings participants')`. Rejects cancelled/missing. Computes `isHost`, `isInvited` (a participant **without** `viaLink`), `peers`, `hostPresent`. If `settings.joinAnytime === false && !isHost && !hostPresent` → waiting. If `settings.askToJoin !== false && !isHost && !isInvited` → verify `pass` (`scope==='meet-admit'`, matching `id` + `meetingId`); if no valid pass: host absent → waiting, host present → knock. On success: joins `mtg:<id>`, records host/joinAt/meetings on `socket.data`, best-effort `Meeting.updateOne({startedAt:null},{startedAt, status:'ongoing'})` and pushes an `attendees` row (name/email snapshot) once | ack `cb({ ok:true, peers:[{socketId,userId,name,avatar}], isHost })`, or `cb({ ok:false, error })` / `cb({ ok:false, waiting:true, error })` / `cb({ ok:false, knocking:true, error })`. Also `meeting:peer-joined` `{socketId,userId,name,avatar}` to the room (sender excluded), and `meeting:knock` `{meetingId,socketId,userId,name,avatar}` to **each host socket in the room** when knocking |
| `meeting:signal` | `{ meetingId, to, data }` (`to` = target **socketId**; `data` is opaque `{kind:'offer'\|'answer'\|'ice', sdp\|candidate}`) | sender must be in `mtg:<meetingId>` (prevents cross-room injection) | relay to one socket | `meeting:signal` `{ from: socket.id, data }` → `ioRef.to(to)` |
| `meeting:presenting` | `{ meetingId, on }` | in-room | relay | `meeting:presenting` `{ socketId, on: !!on }` to room, sender excluded |
| `meeting:chat` | `{ meetingId, text }` | in-room; text trimmed and `.slice(0, 2000)`; empty is dropped | relay (not persisted) | `meeting:chat` `{ socketId, userId, name, avatar, text, at: Date.now() }` to room, sender excluded (sender echoes optimistically) |
| `meeting:reaction` | `{ meetingId, emoji }` | in-room; `emoji.slice(0,8)`, empty dropped | relay | `meeting:reaction` `{ socketId, userId, name, emoji }` to room, sender excluded |
| `meeting:hand` | `{ meetingId, up }` | in-room | relay | `meeting:hand` `{ socketId, userId, name, up: !!up }` to room, sender excluded |
| `meeting:admit` | `{ meetingId, socketId, userId, allow }` | in-room **and** `socket.data.meetingHost[meetingId]` **and** `socketId` truthy **and** `isId(userId)` | `allow` → mint `signMeetingPass(guestId, meetingId)` (15 min, `scope:'meet-admit'`) | to the guest socket: `meeting:admitted` `{ meetingId, pass }` **or** `meeting:denied` `{ meetingId }`; to the host's other tabs: `meeting:knock-handled` `{ meetingId, socketId }` |
| `meeting:mute-all` | `{ meetingId }` | in-room + room host | relay (advisory — a compliant client mutes itself) | `meeting:force-mute` `{ by: hostName, all: true }` to room, sender excluded |
| `meeting:force-mute` | `{ meetingId, to? , toUser? }` (`to`=socketId for mesh, `toUser`=userId for the LiveKit/SFU path) | in-room + room host | targeted relay; `toUser` wins over `to` | `meeting:force-mute` `{ by: hostName }` → `user:<toUser>` or the single socket `to` |
| `meeting:remove` | `{ meetingId, to?, toUser? }` | in-room + room host | `fetchSockets()` on the room, selects targets by `toUser` (all their sockets) or exact `to`, never the host's own socket; forces `target.leave(room)` | `meeting:removed` `{ by: hostName }` to each target; `meeting:peer-left` `{ socketId: target.id }` to the room |
| `meeting:leave` | `{ meetingId }` | any (`isId` required) | leaves the room, clears `socket.data.meetings`/`meetingHost`, `finalizeAttendance()` → `$inc attendees.$.durationSeconds`, sets `leftAt`+`endedAt`, and if the room is now empty flips `status: 'ongoing' → 'completed'` | `meeting:peer-left` `{ socketId }` to the room |
| `disconnect` | — | — | For each tracked `callPeers` entry: `transitionCall(callId, me, 'end')`; emits the ended/cancelled pair (below). Then per meeting: `meeting:peer-left` + `finalizeAttendance`. Then presence bookkeeping | `call:ended`+`call-ended`, or `call:cancelled`+`call-missed` when the resulting status is `missed`, payload `{ from, callId, reason: 'peer-disconnected' }`; `meeting:peer-left` `{ socketId }`; `user-offline` `{ userId, lastSeen }` (broadcast) |

---

## 3. Server → Client events

`emitToUser(userId, ev, p)` → `io.to('user:'+userId)`; `emitToChat(chatId, ev, p)` → `io.to('chat:'+chatId)` (both in `server/socket/index.js:54,60`).

### Messaging

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `receive-message` | `{ chatId, message }` (fully populated Message: `sender`, `reactions.user`, `replyTo.sender`) | `POST /api/messages` → per-participant `emitToUser` (`messageController.js:149`); `POST /api/messages/poll` (`:364`); group system messages via `emitToChat` (`groupController.js:22`); live-location start (`liveLocationController.js:41`); broadcast lists (`broadcastController.js:108`); catalog product share (`catalogController.js:153`); business auto-reply (`utils/autoReply.js:35`); inbound webhook (`webhookController.js:100`) | `client/src/hooks/useSocket.js:110` → `appendMessage`, then auto-emits `message:delivered`, and `message:read` if that chat is active+visible; else notification bell + `playMessageTone()` + `notifyMessage()` |
| `message:status` | `{ chatId, messageId, userId, status: 'delivered' }` | after a successful `message:delivered` write (`socket/index.js:221`) | `useSocket.js:200` → `markDelivered(chatId, messageId, uid)` (only handles `'delivered'`) |
| `message:read` | `{ chatId, userId }` | after a successful `message:read` write, **only if the reader allows read receipts** (`socket/index.js:237`) | `useSocket.js:203` → `markReadBy(chatId, uid)` |
| `message-read` | `{ chatId, messageIds, userId }` (socket relay) / `{ chatId, userId }` (REST `POST /api/messages/read`, `messageController.js:284`, gated on `privacy.readReceipts`) | socket relay + REST mark-read | **No client listener** — legacy/dash-form alias; the live UI runs on `message:read` |
| `message-edited` | `{ chatId, message }` (populated) | `PATCH /api/messages/:id` within the 5-minute `EDIT_WINDOW_MS` (`messageController.js:200`) | `useSocket.js:206` → `applyEditedMessage` |
| `message-updated` | `{ chatId, message }` (populated) | poll vote (`messageController.js:400`), view-once consumed (`:324`) | `useSocket.js:208` → `applyEditedMessage` |
| `message-deleted` | `{ chatId, messageId, scope: 'everyone' }` | `DELETE /api/messages/:id?scope=everyone`, sender-only, within `DELETE_EVERYONE_WINDOW_MS` = 5 min (`messageController.js:224`). `scope=me` emits **nothing** | `useSocket.js:209` → `applyDeletedMessage(chatId, messageId, scope \|\| 'everyone')` |
| `message-reaction` | REST: `{ chatId, messageId, reactions }` (populated `reactions.user`) — `messageController.js:250`. Socket relay: whatever the emitter sent | `POST /api/messages/:id/react`; or the `message-reaction` socket relay | `useSocket.js:210` → `applyReaction(chatId, messageId, reactions)` |
| `message-pinned` | `{ chatId, messageId, pinned }` | `POST /api/messages/:id/pin` toggle (`messageController.js:411`) | `useSocket.js:170` → `applyPinned` |
| `typing-start` / `typing-stop` | `{ chatId, userId }` | socket relay from a chat member | `useSocket.js:147-148` → `setTyping(chatId, userId, bool)`. Emitted from `client/src/components/chat/MessageComposer.jsx:139,144,157` |

### Chat / group

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `chat-updated` | `{ chatId }` | after a message/poll/live-location/broadcast/catalog/auto-reply/webhook send, to every participant **except** the sender; group create/add/remove member (`groupController.js:54,99,122`) | `useSocket.js:154` — refetches the chat list **only** when `chatId` is unknown locally, debounced 400 ms (otherwise `receive-message` already patched the sidebar) |
| `chat-disappearing` | `{ chatId, seconds }` | `chatController.js:143` (disappearing-messages timer changed) — `emitToChat` | `useSocket.js:160` → `applyDisappearing(chatId, seconds)` |
| `group-updated` | `{ chat }` — full populated Chat (name/avatar/description/messagingPolicy edit `groupController.js:140`, add members `:157`, remove member `:188`, role change `:214`). **Inconsistency:** `leaveGroup` emits `{ chatId }` with no `chat` (`groupController.js:233`) | group metadata mutations, `emitToChat` | `useSocket.js:163` → `applyChatUpdate(chat)` — guarded by `if (chat)`, so the `leaveGroup` variant is silently dropped |

### Presence

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `presence-snapshot` | `{ online: [userId, ...] }` | `socket.emit` to the connecting socket only, at the end of the `connection` handler (`socket/index.js:663`). **Local instance only** — `onlineUserIds()` never consults Redis | `useSocket.js:213` → `setPresenceSnapshot(online)` |
| `user-online` | `{ userId }` | `socket.broadcast.emit` when a user's first socket connects | `useSocket.js:214` → `setUserOnline` |
| `user-offline` | `{ userId, lastSeen }` | `socket.broadcast.emit` on disconnect of the last socket, and only if `isUserOnline()` is false fleet-wide | `useSocket.js:215` → `setUserOffline` |
| `presence-state` | `{ userId, state }`, `state ∈ available\|away\|busy\|dnd` | `PATCH /api/users/me/presence` (`userController.js:129`) — note it is emitted **only back to the actor's own room**, not to contacts, despite the comment | **No client listener** (dead event) |

### Contacts / status / meetings

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `contact-request` | `{ from: { _id, name, avatar } }` | `POST /api/users/me/contacts/:id` (`userController.js:186`), `contactController.js:59` | `useSocket.js:173` → bell entry + toast + `useContacts.load()` |
| `contact-accepted` | `{ by: <name string> }` | `contactController.js:36` (auto-accept of a reciprocal pending request) and `:94` (explicit accept) | `useSocket.js:178` → bell + success toast + `useContacts.load()` |
| `status-updated` | `{ userId, statusId? }` on post, `{ userId, removedId? }` on delete — hint only, no content | status post/delete → `notifyStatusAudience()` fans out to the owner's contacts filtered by the status audience (`selected`/`except`) — `statusController.js:28` | `useSocket.js:208` → applies `removedId` immediately, then a debounced 400 ms `useStatus.load()` (server re-applies privacy). Also refetched on socket **reconnect**, since this event is fire-and-forget and anything sent while the tab was disconnected is otherwise lost |
| `status-viewed` | `{ statusId, viewer: {_id,name,username,avatar}, at, viewerCount }` | sent to the status OWNER only, and only for a **new** viewer — a re-view or a self-view emits nothing (`statusController.js:136`) | `useSocket.js:218` → `useStatus.applyStatusViewed()` patches the viewer into the item in place, so the count and avatar row move while the owner is looking at them |
| `status-reply` | `{ from: <name>, text }` | replying to a status (`statusController.js:158`) | `useSocket.js:221` → bell + toast |
| `meeting-invited` | `{ meetingId, title, startAt }` | meeting created/invitees added (`meetingController.js:133`) | `useSocket.js:194` → bell + `📅` toast (only reads `title`) |

### Live location

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `live-location` | `{ chatId, messageId, userId, lat, lng }` | `POST /api/live-location/:messageId/update` — sharer only, `emitToChat` (`liveLocationController.js:62`). Lightweight by design (high frequency) | `useSocket.js:166` → `applyLiveLocation(chatId, messageId, lat, lng)` |
| `live-location-stopped` | `{ chatId, messageId }` | `POST /api/live-location/:messageId/stop` (`:79`) | `useSocket.js:167` → `applyLiveLocationStopped` |
| (start) `receive-message` | populated `type:'location'` message with `liveLocation.active = true`, `expiresAt` (60 s … 8 h) | `POST /api/live-location/start` | normal `receive-message` path |

### Calls (server → client)

Every call signal is emitted under **both** naming schemes; the current client listens only to the `call:*` forms (`useWebRTC.js:805-816`).

| Event (+ alias) | Payload | When emitted | Client handler |
|---|---|---|---|
| `call:incoming` + `incoming-call` | `{ from, callId, type, caller, chatId, isGroup }` | relayed from `call:invite` after the contact/group gate and the online check. Also emitted by REST `POST /api/calls` with a **different shape**: `{ callId, from: {_id,name,avatar}, type, isGroup, chatId }` — note `from` is an object there (`callController.js:132`) | `useSocket.js:219`: ignores self; if `ui.call \|\| ui.inMeeting` → emits `call:busy` + `showBusyIncoming` + missed-call bell entry; else OS notification (`notifyIncomingCallDesktop`) + `ui.startCall({direction:'incoming', …})` |
| `call:accepted` + `accept-call` | `{ from, callId, chatId }` | peer accepted | `useWebRTC.js:648` `onAccepted` → create offer (if I rang them) or `meshConnect()` |
| `call:introduced` | `{ from, callId, peer:{_id,name,avatar} }` | conference fan-out | `useWebRTC.js:675` `onIntroduced` → `call:accept` to the new peer |
| `call:offer` + `webrtc-offer` | `{ from, offer, callId, chatId }` | relayed | `useWebRTC.js:686` `onOffer` → answer (re-uses an existing PC for ICE-restart renegotiation) |
| `call:answer` + `webrtc-answer` | `{ from, answer, callId, chatId }` | relayed | `useWebRTC.js:704` `onAnswer` |
| `call:ice-candidate` + `webrtc-ice-candidate` | `{ from, candidate, callId, chatId }` | relayed | `useWebRTC.js:716` `onCandidate` (buffers into `candBufRef` until `remoteDescription` exists) |
| `call:rejected` + `reject-call` | `{ from, callId }` | callee rejected | `useWebRTC.js:734` → `teardown('declined', {linger:1600})` for the primary leg, else `closePeer` |
| `call:cancelled` + `call-missed` | `{ from, callId }` (+ `reason:'peer-disconnected'` on the disconnect path) | caller cancelled/timed out, or caller's socket died while still ringing | `useWebRTC.js:746` → "Missed call" toast + `teardown('missed')` |
| `call:ended` + `call-ended` | `{ from, callId }` (+ `reason`) | hang-up, or peer socket died after the call went live | `useWebRTC.js:769` → `closePeer`, `teardown('ended')` when no legs remain |
| `call:unavailable` | `{ callId, to }` | callee offline at invite time — `socket.emit` back to the **caller** | `useWebRTC.js:757` → "is offline" toast + `teardown('unavailable', {linger:1600})` |
| `call:busy` | `{ from, callId }` | callee was already on a call/in a meeting | `useWebRTC.js:786` → `teardown('busy', {linger:2000})` |
| `call:handled` | `{ callId }` | to the accepter's/rejecter's **other** sockets | `useWebRTC.js:781` → `teardown('ended')` if still `incoming` (closes the duplicate popup) |
| `call:screen` | `{ from, callId, on }` | presenter toggled screen share | `useWebRTC.js:799` → `setRemotePresenters` (spotlight/contain fit) |

### Meeting mesh (`mtg:<id>`)

| Event | Payload | When emitted | Client handler |
|---|---|---|---|
| `meeting:peer-joined` | `{ socketId, userId, name, avatar }` | someone joined the room (sender excluded) | mesh: `useMeetingRoom.js:153` (records the user; the **newcomer** offers, so no glare) · SFU: `useLiveKitRoom.js:144` (roster only) |
| `meeting:peer-left` | `{ socketId }` | `meeting:leave`, host `meeting:remove`, or `disconnect` | `useMeetingRoom.js:159` → `closePeer` + drop raised hand |
| `meeting:signal` | `{ from: socketId, data }` | targeted relay | `useMeetingRoom.js:131` `onSignal` (`kind: 'offer'\|'answer'\|'ice'`) |
| `meeting:presenting` | `{ socketId, on }` | presenter toggle | `useMeetingRoom.js:164` → `setPresenterSid` |
| `meeting:chat` | `{ socketId, userId, name, avatar, text, at }` | in-meeting chat | `useMeetingRoom.js:169` (keys by `socketId`) · `useLiveKitRoom.js:145` (keys by `userId`) |
| `meeting:reaction` | `{ socketId, userId, name, emoji }` | reaction burst | `useMeetingRoom.js:172` (socketId) · `useLiveKitRoom.js:146` (userId) — the dual keys exist precisely because SFU tiles are per-user |
| `meeting:hand` | `{ socketId, userId, name, up }` | raise/lower hand | `useMeetingRoom.js:177` · `useLiveKitRoom.js:151` |
| `meeting:knock` | `{ meetingId, socketId, userId, name, avatar }` | an un-invited guest hit `meeting:join` while the host is present — sent **only to host sockets in the room** | `useMeetingRoom.js:193` / `useLiveKitRoom.js:155` → `knocks[]`, auto-expiring after 90 s |
| `meeting:knock-handled` | `{ meetingId, socketId }` | host answered on one tab → clears the prompt on their others | `useMeetingRoom.js:200` / `useLiveKitRoom.js:160` |
| `meeting:admitted` | `{ meetingId, pass }` (15-min `meet-admit` JWT) | host allowed the guest | `useMeetingRoom.js:268` → store pass, re-`join()` · `useLiveKitRoom.js:220` → re-join **then** `GET /meetings/code/:code/rtc?pass=…` for a LiveKit token |
| `meeting:denied` | `{ meetingId }` | host denied | `useMeetingRoom.js:275` / `useLiveKitRoom.js:227` → `status:'denied'` |
| `meeting:force-mute` | `{ by, all? }` | `meeting:mute-all` (with `all:true`) or targeted `meeting:force-mute` | `useMeetingRoom.js:181` disables local audio tracks · `useLiveKitRoom.js:152` `setMicrophoneEnabled(false)` |
| `meeting:removed` | `{ by }` | host removed this participant | `useMeetingRoom.js:188` / `useLiveKitRoom.js:153` → `status:'left'` |

---

## 4. Exact call-signaling sequences

Client timings (`useWebRTC.js:43-45`): `RING_TIMEOUT_MS = 35000`, `INCOMING_TIMEOUT_MS = 45000`, `CONNECT_TIMEOUT_MS = 30000`; `MAX_ICE_RESTARTS = 5`, `FAILED_DROP_GRACE_MS = 15000`.

### A. Successful 1:1 call

1. **Caller** `getUserMedia()` (audio `{echoCancellation,noiseSuppression,autoGainControl}`, video 1280×720 if `type==='video'`).
2. **Caller** `POST /api/calls/start { receiverId, callType }` → `assertMutualContacts` (403 `You can only call your contacts.`), `isUserOnline(receiverId)`, creates the `Call` (`status: 'ringing'`, or `'missed'` + `endedAt` if offline), fires a Web Push, returns `201 { call, receiverOnline }`. `callIdRef = call._id`. If `receiverOnline === false` → `teardown('unavailable', 1800)`, **no socket traffic**.
3. **Caller → server** `call:invite { to, callId, type, caller:{_id,name,avatar} }` (no `chatId`).
4. **Server** `canSignal` (mutual contacts) → `isUserOnline(to)` → `trackPeer` → `registerCallInvitee` → **server → callee** `call:incoming` + `incoming-call { from, callId, type, caller, chatId: undefined, isGroup: false }`. Caller sets `status:'calling'` → ringback tone; arms the 35 s timer.
5. **Callee** `ui.startCall({direction:'incoming'})`, `status:'incoming'` → ringtone + OS notification if unfocused.
6. **Callee** `accept()` → `getMedia()` → **callee → server** `call:accept { to: caller, callId }`; `status:'connecting'` + 30 s connect timer.
7. **Server** `canCallSignal` → `transitionCall('accept')` (`accepted`, `answeredAt`, participant `joined`) → **→ caller** `call:accepted` + `accept-call`; **→ callee's other sockets** `call:handled { callId }`.
8. **Caller** `onAccepted` → `createPeer(remote, stream, initiator=true)` → `createOffer()` / `setLocalDescription` → `call:offer { to, offer, callId }` (+ `introduceAround` no-ops for a 1:1).
9. **Server** `canCallSignal` → `trackPeer` → **→ callee** `call:offer` + `webrtc-offer`.
10. **Callee** `onOffer` → `createPeer(initiator=false)` → `setRemoteDescription` → `flushCandidates` → `createAnswer`/`setLocalDescription` → `call:answer { to, answer, callId }` → relayed → **caller** `setRemoteDescription` + `flushCandidates`.
11. **Both**, continuously from `pc.onicecandidate`: `call:ice-candidate { to, candidate, callId }` → relayed. Candidates arriving before `remoteDescription` are buffered in `candBufRef`.
12. `pc.connectionState === 'connected'` → timers cleared, `connectedAtRef = Date.now()`, `status:'connected'`; if already screen-sharing → `call:screen { to, on: true }`.
13. **Hang-up**: `call:end { to, callId, duration: liveDuration() }` → `transitionCall('end')` → `status:'completed'`, `endedAt`, `duration` (client value if finite & ≥0, else computed from `answeredAt`), participant `left` → **→ peer** `call:ended` + `call-ended` → peer `teardown('ended')`.

Recovery inside step 12: `'disconnected'` → `status:'reconnecting'` (primary leg) and after 2.5 s an ICE restart, driven **only** by `pc.__ccInitiator` (no glare); `'failed'` on a previously-connected leg → up to 5 `createOffer({iceRestart:true})` rounds re-using `call:offer`, with a 15 s `dropLeg` safety net.

### B. Rejected call

1–5 as above.
6. **Callee** `reject()` → `call:reject { to, callId }`.
7. **Server**: `transitionCall('reject')` **first, unconditionally** (`status:'rejected'`, `endedAt`, participant `rejected`), `untrackPeer(to)`, then — if `canCallSignal` passes — **→ caller** `call:rejected` + `reject-call { from, callId }`; **→ callee's other tabs** `call:handled`.
8. **Caller** `onRejected`: primary leg & never connected → `🚫 "<name> declined the call."` + `teardown('declined', {linger:1600})`. A non-primary (conference) leg → toast + `closePeer` only.

A failed `getMedia()` on accept also emits `call:reject` (`useWebRTC.js:495-496`) so the caller isn't left ringing.

### C. Cancelled / missed call

**Caller-driven cancel (ring timeout or manual):**
1. 35 s elapse with `status !== 'connected'`. If `status === 'connecting'` (they answered, media still negotiating) the caller **never cancels** — it arms a further 30 s `CONNECT_TIMEOUT_MS` and fails with `teardown('error', 2200)`.
2. Otherwise **caller → server** `call:cancel { to, callId }`; local `📵 "<name> didn't answer."` + `teardown('noanswer', {linger:1600})`.
3. **Server** `transitionCall('missed')` (`ringing → missed`, `endedAt`, receiver participant `missed`), `untrackPeer`, then gated relay **→ callee** `call:cancelled` + `call-missed`.
4. **Callee** `onCancelled` (ignored if already connected) → `📵 "Missed call from <name>."` → `teardown('missed')`.

**Callee-side safety net:** 45 s in `status === 'incoming'` → local `teardown('missed')`, **no emit** (the caller's own timeout covers the record).

**Caller/callee process death:** the `disconnect` handler walks `callPeers` (`peerId → callId`), runs `transitionCall(callId, me, 'end')`; `end`-while-ringing maps to `missed`, so it relays `call:cancelled` + `call-missed` (closing the peer's ringing popup) rather than `call:ended` + `call-ended`, with `reason: 'peer-disconnected'`.

**Both sides dead:** `sweepStaleCalls()` on a 60 s interval (`server.js:156`) — `ringing` older than 90 s → `missed`; `accepted`/`ongoing` untouched for 12 h → `completed`.

### D. Busy

1–4 as in A.
5. **Callee's `useSocket` handler** sees `ui.call || ui.inMeeting` → **callee → server** `call:busy { to: from, callId, chatId }`, shows `showBusyIncoming(...)` and pushes a `missed_call` bell entry. The ringing UI is never opened.
6. **Server** `transitionCall('missed')`, then gated relay **→ caller** `call:busy { from, callId }`.
7. **Caller** `onBusy` (ignored once connected) → `⏳ "<name> is busy on another call."` → `teardown('busy', {linger:2000})` (primary) or `closePeer` (conference leg).

### E. Group call mesh

**E1 — group-chat call (`chatId` present, `isGroupCall === true`):**

1. Caller `getMedia()`, `rosterUsers()` = the group chat's participants minus self. Empty roster → local preview only (`status:'demo'` after 1.8 s).
2. Caller emits, **per member**, `call:invite { to, callId, chatId, type, caller }`. Every subsequent signal carries `chatId` via `emitSig()`, which is what authorizes group members who are not personal contacts.
3. Server per invite: `canSignal(me,to,chatId)` → group-membership branch → online check (an offline member yields `call:unavailable` to the caller, which just `closePeer`s that leg) → `call:incoming { …, chatId, isGroup: true }`.
4. Each callee resolves the group chat locally and opens the incoming UI with `group` attached.
5. On accept, a callee runs `announceReady()` → `call:accept` to **every roster member**, not just the caller (it doubles as the mesh "I'm here" hello — hence the `canSignal` gate on accept).
6. Each recipient's `onAccepted` → `meshConnect(remote)`: **deterministic pair rule** — if `myId < remote` (string compare) I create the offer (`createPeer(initiator=true)` → `call:offer`); otherwise I re-greet **once** (`helloBackRef`) with `call:accept` so *they* offer. This kills glare and fixes hello-ordering races.
7. `call:offer` / `call:answer` / `call:ice-candidate` per pair, each authorized by `canCallSignal(to, chatId, callId)`; positive results are cached per socket in `signalAuthCache` keyed `"to:chatId:callId"` (negatives are never cached — a `false` may be a transient race).
8. `call:screen` is sent per leg; `hangUp()` emits `call:end` (or `call:cancel` if never connected and outgoing) to the union of `peerId`, `participantsRef` keys and `peersRef` keys.
9. If nothing connects in 35 s → `call:cancel` to every roster member + `teardown('noanswer', 1600)`.

*Caveat:* a group-chat call created purely from the header never hits `POST /api/calls/start`, so `callIdRef` stays `local-<rand>`; `transitionCall`/`registerCallInvitee` bail on the non-ObjectId (`mongoose.isValidObjectId` guard) and no `Call` history row is written. Authorization still works, because it comes from `chatId` group membership. `POST /api/calls` (`callController.js:99`) is the legacy path that *does* create a group `Call` record and emits `call:incoming` itself.

**E2 — ad-hoc conference (1:1 + "add people", `chatId` absent):**

1. A normal 1:1 call is live (sequence A).
2. Host `addParticipants([users])` → per user `call:invite { to, callId, type, caller }` — **contact-gated** (no `chatId` fallback) — plus a per-leg 35 s ring timer. Server `registerCallInvitee(callId, host, invitee)` pushes them onto `Call.participants` (no status guard, so people can be added even after the record went `completed`).
3. Invitee accepts → `call:accept` to the host. Host's `onAccepted` sees `invitedRef.has(remote)` → host is the offerer → `call:offer`, then `introduceAround(newId)`.
4. `introduceAround` emits, for every other known participant `X`: `call:introduce { to: X, callId, peer: newcomer }` **and** `call:introduce { to: newcomer, callId, peer: X }`.
5. Server `call:introduce` requires `inSameCall(callId, me, to)` — pure call-record membership, no contact check — and relays `call:introduced`.
6. Each recipient of `call:introduced` emits `call:accept { to: peer._id }`; both ends then run the same lower-id-offers `meshConnect` rule. Their offer/answer/ICE pass `canCallSignal` through the `inSameCall` branch even though they are strangers — membership was vouched for by the contact-gated invite in step 2.

### F. Validation & gating summary

**Id validation.** `isId()` (ObjectId check) is applied to: `messageId` in `message:delivered`, `meetingId` in `meeting:join`/`leaveMeeting`, the guest `userId` in `meeting:admit`, and inside `transitionCall`/`registerCallInvitee`/`inSameCall` (they return `null`/`false` on a non-ObjectId). Chat ids are validated implicitly by `isChatMember()` (which try/catches a bad ObjectId). Rationale in the file header: socket payloads bypass Express `mongoSanitize`, so `{ chatId: { $ne: null } }` must not reach a query.

| Gate | Applies to |
|---|---|
| **Contact-gated only** (`canSignal` = mutual contacts **or** same group chat via `chatId`) — no fallback | `call:invite` / `call-user` |
| **Contact-gated with call-membership fallback** (`canCallSignal` = `canSignal` ∨ `inSameCall`), positive results cached per socket | `call:accept`, `call:reject`, `call:busy`, `call:screen`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:cancel`, `call:end` |
| **Call-record membership only** (`inSameCall`) | `call:introduce` |
| **Chat membership** (`isChatMember` DB query) | `join-chat`, `message:delivered`, `message:read` |
| **Chat-room membership** (`socket.rooms.has('chat:'+id)` — free authz, since the room is only joinable after `isChatMember`) | `typing-start`, `typing-stop`, `message-read`, `message-reaction` |
| **Meeting-room membership** (`socket.rooms.has('mtg:'+id)`) | `meeting:signal`, `meeting:presenting`, `meeting:chat`, `meeting:reaction`, `meeting:hand` |
| **Meeting host** (`socket.data.meetingHost[meetingId]`, stamped at join — no DB hit) **+ in-room** | `meeting:admit`, `meeting:mute-all`, `meeting:force-mute`, `meeting:remove` |
| **Open to any authenticated socket** | `register-user`, `leave-chat`, `meeting:leave`, and `meeting:join` (subject to meeting status / `joinAnytime` / `askToJoin` + signed pass, deliberately open so shareable links work) |

Two things deliberately **not** gated: answer/ICE/end "only make sense inside an already-initiated call" per the file comment; and `transitionCall` runs *before* the relay gate on `call:reject`/`call:busy`/`call:cancel`/`call:end` — safe because `transitionCall` itself requires `isInvolved(call, userId)`, so a stranger's `callId` guess mutates nothing (it returns `null`).

---


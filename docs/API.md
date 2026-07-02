# ChatConnect — API Reference

Base URL: `http://localhost:5000/api`

All protected routes require a JWT, sent either as an `httpOnly` cookie (`token`) set on login, or an `Authorization: Bearer <token>` header. Responses are JSON of the shape `{ success, ... }`; errors are `{ success: false, message }`.

---

## Auth — `/auth`
| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/signup` | – | `{ name, email, password, confirmPassword?, avatar? }` → token (or `requiresVerification` if email verification is on). `avatar` is an optional small `data:image/...` URL. A unique username is auto-generated from the email. **`role`/`isAdmin`/`admin` in the body are ignored — every signup is `role: "user"`.** Password min 8 chars. |
| POST | `/verify-otp` | – | `{ email, otp }` |
| POST | `/resend-otp` | – | `{ email }` |
| POST | `/login` | – | `{ email, password }` → token + user |
| POST | `/logout` | – | clears cookie |
| GET | `/me` | ✓ | current user |
| POST | `/forgot-password` | – | `{ email }` (always 200) |
| POST | `/reset-password/:token` | – | `{ password }` |
| PATCH | `/change-password` | ✓ | `{ currentPassword, newPassword }` |

## Users — `/users`
| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=` | search by name / username / email |
| GET | `/:id` | public profile |
| PATCH | `/me` | update `{ name, username, bio, avatar, phone }` |
| PATCH | `/me/privacy` | update privacy settings |
| PATCH | `/me/settings` | update app settings |
| DELETE | `/me` | delete account |
| GET | `/me/contacts` | contacts + favorites |
| POST/DELETE | `/me/contacts/:id` | add / remove contact |
| POST | `/me/favorites/:id` | toggle favorite |
| POST | `/me/block/:id` | toggle block |
| POST | `/me/chats/:chatId/:action` | `action` = `pin` \| `archive` \| `mute` (toggle) |

## Chats — `/chats`
| Method | Path | Notes |
|---|---|---|
| GET | `/` | all conversations (+ unread counts) |
| POST | `/direct/:userId` | get-or-create a 1:1 chat |
| GET | `/:id` | one chat |
| DELETE | `/:id/clear` | clear messages (for me) |
| DELETE | `/:id` | leave / remove chat |

## Messages — `/messages`
| Method | Path | Notes |
|---|---|---|
| POST | `/` | send `{ chatId, content, type, replyTo, attachments, location, mentions }` |
| GET | `/:chatId?before=&limit=` | paginated history |
| GET | `/:chatId/search?q=` | search within a chat |
| PATCH | `/:id` | edit `{ content }` |
| DELETE | `/:id?scope=me\|everyone` | delete |
| POST | `/:id/react` | `{ emoji }` (toggle) |
| POST | `/:id/star` · `/:id/pin` | toggle |
| GET | `/starred` | starred messages |
| POST | `/read` | `{ chatId }` mark read |

## Groups — `/groups`
| Method | Path | Notes |
|---|---|---|
| POST | `/` | create `{ name, description, avatar, members[] }` |
| PATCH | `/:id` | update group info / `messagingPolicy` (admin) |
| POST | `/:id/members` | add `{ members[] }` (admin) |
| DELETE | `/:id/members/:userId` | remove (admin) |
| PATCH | `/:id/members/:userId/role` | `{ role: 'admin'\|'member' }` |
| POST | `/:id/leave` | leave group |
| POST | `/join/:inviteCode` | join via invite link |

## Calls — `/calls` (all require auth)
| Method | Path | Notes |
|---|---|---|
| GET | `/history` (alias `/`) | call history, newest first. Each entry includes `caller`, `receiver`, `participants`, `type`/`callType`, `status` (`ringing`/`accepted`/`rejected`/`missed`/`completed`), `startedAt`, `endedAt`, `duration`, plus per-viewer `direction` (`incoming`/`outgoing`) and `peer` (the other person). |
| POST | `/start` | `{ receiverId, callType: 'audio'\|'video' }` → creates the record and returns `{ call, receiverOnline }`. If the receiver is offline the call is logged as **missed** immediately. Caller and receiver must be mutual contacts. |
| POST | `/end` | `{ callId, duration? }` → `completed` (or `missed` if it never connected) |
| POST | `/missed` | `{ callId }` → mark missed |
| POST | `/reject` | `{ callId }` → mark rejected |
| POST | `/` | legacy/group start `{ type, chatId, participants[], isGroup }` (rings callees) |
| PATCH | `/:id` | legacy update `{ status, duration }` |

Call state is **also** persisted automatically by the Socket.IO signaling handlers (accept/reject/cancel/end), so history stays correct even if a client dies mid-call.

## Meetings — `/meetings`
| Method | Path | Notes |
|---|---|---|
| GET | `/` | my meetings |
| POST | `/` | schedule `{ title, startAt, durationMinutes, type, participants[], recurrence, reminderMinutes }` |
| PATCH | `/:id` | edit (host) |
| POST | `/:id/rsvp` | `{ response: 'going'\|'maybe'\|'not_going' }` |
| DELETE | `/:id` | cancel (host) |

## Status — `/status`
| Method | Path | Notes |
|---|---|---|
| GET | `/` | feed (mine + contacts', grouped) |
| POST | `/` | create `{ type, content, media, background, privacy }` |
| POST | `/:id/view` · `/:id/reply` | view / reply |
| GET | `/:id/viewers` | who viewed (owner only) |
| DELETE | `/:id` | delete |

## Contacts — `/contacts`
| Method | Path | Notes |
|---|---|---|
| GET | `/requests` | incoming + outgoing |
| POST | `/request/:userId` | send request |
| PATCH | `/request/:id` | `{ action: 'accept'\|'reject' }` |

## Notifications — `/notifications`
`GET /` · `PATCH /read` (all) · `PATCH /:id/read`

## Reports — `/reports`
`POST /` → `{ targetType, targetUser?, targetChat?, targetMessage?, reason, description }`

## Upload — `/upload`
`POST /` multipart, field `files` (max 10) → `{ attachments: [{ url, name, size, mime }] }`

## Admin — `/admin` (role: admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/stats` | totals + 7-day userGrowth / messageVolume |
| GET | `/users?q=` | list users |
| PATCH | `/users/:id/status` | `{ accountStatus: 'active'\|'suspended'\|'banned' }` |
| GET | `/reports` | list reports |
| PATCH | `/reports/:id` | `{ status }` |

---

# Socket.IO events

Connect with `io(url, { auth: { token } })`. The connection is rejected without a valid JWT.

### Server → client
`presence-snapshot` · `user-online` · `user-offline` · `receive-message` · `message-edited` · `message-deleted` · `message-reaction` · `message-read` · `message-pinned` · `typing-start` · `typing-stop` · `chat-updated` · `group-updated` · `contact-request` · `contact-accepted` · `meeting-invited` · `status-reply`

### Client → server
`join-chat` / `leave-chat` (chatId) · `typing-start` / `typing-stop` `{ chatId }` · `message-read` `{ chatId, messageIds }` · `message-reaction` `{ chatId, ... }`

### WebRTC signaling (relayed to the target user's room)

Every signal is accepted **and** emitted under two equivalent names — the `call:*` scheme and the dash-form aliases — so either convention works:

| Client → server | Server → callee/caller | Purpose |
|---|---|---|
| `call:invite` / `call-user` | `call:incoming` / `incoming-call` | ring `{ to, callId, type, caller }` (only if callee is online; otherwise the caller gets `call:unavailable` and the call is logged missed) |
| `call:accept` / `accept-call` | `call:accepted` / `accept-call` | callee accepted → caller now creates the SDP offer |
| `call:offer` / `webrtc-offer` | `call:offer` / `webrtc-offer` | SDP offer `{ to, offer, callId }` |
| `call:answer` / `webrtc-answer` | `call:answer` / `webrtc-answer` | SDP answer |
| `call:ice-candidate` / `webrtc-ice-candidate` | same | trickle ICE |
| `call:reject` / `reject-call` | `call:rejected` / `reject-call` | callee declined |
| `call:cancel` / `call-missed` | `call:cancelled` / `call-missed` | caller gave up ringing → missed call |
| `call:end` / `end-call` | `call:ended` / `call-ended` | hang-up `{ to, callId, duration? }` |
| `register-user` (ack) | — | optional explicit registration ack; presence is keyed off the JWT handshake |

Each carries `{ to, callId, ... }`; the server stamps `from` (the sender's userId) before forwarding. `call:handled` is emitted to the callee's *other* tabs/devices when one of them accepts/rejects, so duplicate ringing popups close. The full flow: `call-user` → `incoming-call` → `accept-call` → `webrtc-offer` → `webrtc-answer` → ICE exchange → media connects; each transition also updates the Call record (accepted / rejected / missed / completed).

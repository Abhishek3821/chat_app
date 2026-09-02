# Meetings

Scheduled and instant video/audio meetings with shareable Google-Meet-style links,
knock-and-admit admission, in-meeting collaboration (polls, Q&A, captions) and an
attendance record.

- **Model:** `server/models/Meeting.js`
- **API:** `server/controllers/meetingController.js` · `server/routes/meetingRoutes.js`
- **Realtime:** `server/socket/index.js` (room `mtg:<meetingId>`) — full event reference in
  [SOCKET_EVENTS.md](SOCKET_EVENTS.md#meeting-mesh-mtgid)
- **Client:** `store/useMeetings.js` · `hooks/useMeetingRoom.js` (mesh) ·
  `hooks/useLiveKitRoom.js` (SFU) · `pages/MeetingsPage.jsx` · `pages/MeetingRoom.jsx`
- **Related:** [SCALING_CALLS.md](SCALING_CALLS.md) (how many people fit, and why) ·
  [API.md](API.md) · [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)

---

## 1. The shape of it

A meeting is one `Meeting` document plus a socket room. There are two media transports
behind an identical UI:

| Transport | When | How media flows |
|---|---|---|
| **Mesh** (default) | `LIVEKIT_*` not configured | Every participant holds an `RTCPeerConnection` to every other participant |
| **SFU** (LiveKit) | `LIVEKIT_URL` + key/secret set | Each participant sends one stream up and receives one down per peer |

`GET /api/meetings/code/:code/rtc` decides which, per meeting, at join time. `MeetingRoom.jsx`
mounts `MeshRoom` or `SfuRoom` off that answer, and **both render the same `RoomView`** — so
every feature below works identically on either transport unless noted.

A mesh is comfortable to about **6 participants** and degrades to 9; past that you need the
SFU. That is arithmetic, not tuning — see [SCALING_CALLS.md](SCALING_CALLS.md).

---

## 2. Data model

`Meeting` (`server/models/Meeting.js`):

| Field | Type | Notes |
|---|---|---|
| `title` | String, required | max 120. Instant meetings default to `"Instant meeting"` |
| `description` | String | max 1000 |
| `host` | ObjectId → User, required, indexed | the only account that can edit, invite, cancel, admit, or read the report |
| `participants[]` | `rsvpSchema` | `{ user, response, viaLink }` — the invite list |
| `chat` | ObjectId → Chat | optional chat the meeting was created from |
| `startAt` | Date, required | instant meetings use `now` |
| `durationMinutes` | Number | default 30 |
| `timezone` | String | default `UTC`, truncated to 64 chars. Used for the invitation email and `.ics` |
| `type` | `audio \| video` | default `video` |
| `roomCode` | String, unique, indexed | `abc-defg-hij` — see §3 |
| `link` | String | `${CLIENT_URL}/meet/<roomCode>` |
| `settings` | object | `joinAnytime`, `muteOnEntry`, `autoRecord`, `askToJoin` — see §5 |
| `recurrence` | `none \| daily \| weekly \| monthly` | default `none`. See the caveat in §12 |
| `reminderMinutes` | Number | default 10. **Not implemented** — see §12 |
| `status` | `scheduled \| ongoing \| completed \| cancelled` | see §4 |
| `startedAt` / `endedAt` | Date | first join / last leave — written by the socket layer, not the API |
| `attendees[]` | `attendeeSchema` | `{ user, name, email, joinedAt, leftAt, durationSeconds }` |
| `polls[]` | `pollSchema` | `{ question, options[], multi, closed, createdBy, votes[{user, choices[]}] }` |
| `questions[]` | `questionSchema` | `{ text, askedBy, askedByName, anonymous, upvotes[], answered, answerText }` |
| `transcript[]` | `{ user, name, text, at }` | live captions, **capped at 500 lines** in the socket handler |

Indexes: `roomCode` (unique), `host`, `startAt`.

**`viaLink` is the field that matters most.** A participant added by opening the link carries
`viaLink: true`, and that is *not* an invitation — the admission gate in §5 still makes them
knock. Only a participant added by the host (`viaLink` absent) counts as invited.

---

## 3. Room codes

`generateRoomCode()` produces `abc-defg-hij`: three groups from a 32-character
ambiguity-free alphabet (no `l`, `o`, `0`, `1`), drawn with `crypto.randomInt` — not
`Math.random`, so codes cannot be predicted from one another. That is ~50 bits of entropy,
which is what makes "anyone with the link can join" safe to offer.

`createWithRoomCode()` retries up to **5 times** on a duplicate before giving up.

`:code` in every code route accepts **either the room code or the raw meeting id**
(`findByCodeOrId`), so "join by meeting ID" and "join by link" are the same endpoint.

---

## 4. Status lifecycle

```
                    POST /meetings (with startAt)
                              ↓
                        [ scheduled ]
                              │  first person joins (REST join OR socket meeting:join)
                              ↓
   POST /meetings (no startAt) → [ ongoing ] ← instant meetings start here
                              │  last person leaves the socket room
                              ↓
                        [ completed ]

        DELETE /meetings/:id (host) → [ cancelled ]   — terminal, from any state
```

- `ongoing` is set by **both** `joinMeetingByCode` (REST) and `meeting:join` (socket), so a
  meeting is live the moment anyone arrives by any door.
- `completed` is written by the socket `meeting:leave` / `disconnect` path when the room
  empties — never by the API.
- `cancelled` makes every join route answer **410 Gone**.

---

## 5. Joining, and the admission gate

Three doors lead to the same room:

1. **Invited** — the host put you on `participants` at creation or via `/invite`. The meeting
   appears in your list, you get an in-app notification, a push, and an email with an `.ics`.
2. **The link** — `/meet/:roomCode`. Anyone signed in can open it. `POST /code/:code/join`
   adds you with `viaLink: true`.
3. **The meeting ID** — the same endpoints accept the raw `_id`.

### The gate

Evaluated identically in two places (see the warning below):

```
admitted =  isHost
         OR isInvited            (on participants AND NOT viaLink)
         OR settings.askToJoin === false
         OR a valid admission pass
```

Failing that, and depending on whether the host is in the room:

| Host present? | `joinAnytime` | Result |
|---|---|---|
| — | `false`, and you are not the host | `waiting` — "the host hasn't started this meeting" |
| No | `true` | `waiting` |
| Yes | `true` | **knock** — the host sees a prompt and admits or denies you |

### The admission pass

When a host admits a knocker, the server mints a **`meet-admit` JWT** (`signMeetingPass`,
15-minute expiry) bound to that user id *and* that meeting id, and sends it to the guest as
`meeting:admitted { meetingId, pass }`. The guest re-joins with it.

> ### ⚠ Both admission paths must stay in step
>
> The socket `meeting:join` handler and `GET /code/:code/rtc` each evaluate the gate
> **independently**. `/rtc` mints a LiveKit token, so if its copy of the check is weaker, a
> knocker can mint themselves a working media token and connect straight to the SFU room —
> bypassing the knock entirely while the socket path politely asks them to wait.
>
> This exact hole existed and was fixed (never exploited; LiveKit is off by default). If you
> change one gate, change the other, and check `meeting-visibility.mjs` still passes.

---

## 5b. Capacity — the ceiling is ENFORCED

A mesh meeting refuses the joiner who would break it rather than admitting them
and degrading the room for everyone already talking.

| Room size | What happens |
|---|---|
| 2 | 720p, ~1.2 Mbps per stream |
| 3 – 4 | 480p, ~700 kbps |
| 5 – 6 | 360p, ~350 kbps |
| 7 – 9 | 240p, ~180 kbps, plus an amber in-room warning |
| 10+ | `meeting:join` is **refused**: `{ ok:false, full:true, limit, error }` |

The limit is `MESH_MAX_PARTICIPANTS` (`server/utils/meetingCapacity.js`), default
**9**, clamped 2–50 so a typo cannot silently disable the gate. Encoder tiers come
from `client/src/lib/meshQuality.js` and are re-applied to every leg whenever
someone joins or leaves.

Checked **before** the waiting/knock branches, so a full room answers at once
instead of making someone knock — and the host is not pestered to admit a guest
who cannot fit.

### Two exemptions

- **The host is never refused.** Being locked out of your own meeting, unable to
  end it or remove anyone, is worse than one extra participant. A host still
  *occupies* a seat, so a full room with the host present needs **two** departures
  before the next guest fits — surprising the first time you hit it, and asserted
  explicitly in the suite for that reason.
- **No cap when an SFU is configured** (`LIVEKIT_*`). Each device then sends one
  stream and the server fans it out, so the mesh arithmetic does not apply.
  Leaving the cap in place would be an invisible limit surviving the upgrade.

The client-side warning from ~6 participants is advisory; this is the control. A
banner cannot stop a twentieth person joining.

Verified by `server/tests/meeting-capacity.mjs` (15 checks), validated by
disabling the gate and confirming the suite fails.

See [SCALING_CALLS.md](SCALING_CALLS.md) for why a mesh stops at about six.

---
## 6. REST API

All routes are `protect`-authenticated and gated by `requireFeature('meetings')` — a no-op for
first-party users, a real capability check for embedded tenants.

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/api/meetings` | any | Meetings you host **or** are a participant of, sorted by `startAt`. Adds `attendeeCount` + `durationSeconds`; **strips `attendees` unless you are the host** |
| `POST` | `/api/meetings` | any | Create. No `startAt` ⇒ **instant** (`status: 'ongoing'`, starts now). Returns `invitesQueued` |
| `GET` | `/api/meetings/code/:code` | any signed-in | Pre-join summary: title, type, status, host, settings, `isHost`. `410` if cancelled |
| `GET` | `/api/meetings/code/:code/rtc` | any signed-in | Media transport. `{enabled:false}` = use the mesh. `{enabled:true, requiresAdmission:true}` = knock first. Otherwise `{url, token, room}` |
| `POST` | `/api/meetings/code/:code/join` | any signed-in | Adds you with `viaLink:true`, flips `scheduled → ongoing` |
| `GET` | `/api/meetings/:id/report` | **host only** | Attendance record, sorted by join time. `403` otherwise |
| `PATCH` | `/api/meetings/:id` | **host only** | Whitelisted fields only: title, description, startAt, durationMinutes, timezone, type, recurrence, reminderMinutes, and `settings` |
| `POST` | `/api/meetings/:id/invite` | **host only** | `{userIds[], emails[]}`. Returns `added`, `skipped`, `alreadyInvited`, `unreachable`, `invitesQueued` |
| `POST` | `/api/meetings/:id/rsvp` | invitee or host | `going \| maybe \| not_going`. `403` if you were never invited — otherwise anyone could inject themselves into any meeting's roster |
| `DELETE` | `/api/meetings/:id` | **host only** | Sets `status: 'cancelled'`. Not a delete |

### Two things the API deliberately does

**Mass assignment is blocked on update.** `PATCH` whitelists its fields, so a body can never
reassign `host`, `participants`, `link`, `roomCode`, `chat` or `status`.

**Invitees are tenant-scoped, not workspace-scoped.** `createMeeting` and `inviteToMeeting`
resolve users with `tenantScope(req.user)` and nothing else. An earlier version also required
`workspace: req.user.workspace`, which **silently dropped** any invitee in another workspace —
absent from `participants`, never notified, while the host saw a successful invite. That also
contradicted the rest of the product, where contacts and DMs cross workspaces by design. The
tenant boundary is kept because it is a real isolation guarantee.

`/invite` reports **why** someone was not added — `alreadyInvited` vs `unreachable` (deleted
account, or another tenant's user) — rather than one opaque number.

---

## 7. Realtime layer

Room: **`mtg:<meetingId>`**. Joined only after the gate in §5 passes. The full event table with
payloads lives in [SOCKET_EVENTS.md](SOCKET_EVENTS.md#meeting-mesh-mtgid); in summary:

| Group | Events |
|---|---|
| Membership | `meeting:join` (ack callback), `meeting:peer-joined`, `meeting:peer-left`, `meeting:leave` |
| Signalling | `meeting:signal` — opaque `{kind:'offer'\|'answer'\|'ice'}` relayed to one socket |
| Admission | `meeting:knock`, `meeting:admit`, `meeting:admitted`, `meeting:denied`, `meeting:knock-handled` |
| Interaction | `meeting:chat`, `meeting:reaction`, `meeting:hand`, `meeting:presenting` |
| Collaboration | `meeting:poll-create/vote/close` → `meeting:polls` · `meeting:qa-ask/upvote/answer` → `meeting:questions` · `meeting:caption` |
| Host control | `meeting:mute-all`, `meeting:force-mute`, `meeting:remove` → `meeting:removed` |

Three contract details that cost time if you guess:

- **`meeting:join` answers through an ACK CALLBACK**, not an event. Wait on the ack.
- **`meeting:remove` / `meeting:force-mute` target `to` (a socketId) or `toUser` (a userId)** —
  not `socketId`. `toUser` wins when both are present.
- **Polls and Q&A are server-authoritative**: the whole collection is re-broadcast on every
  change. Clients replace, never merge, and a late joiner is correct after one event.

---

## 8. Mesh implementation

`hooks/useMeetingRoom.js`. One `RTCPeerConnection` per remote **socket id** — so the same
person joining from two tabs is two peers, which is correct.

**Glare avoidance:** the *newcomer* offers to everyone already in the room (from the peers list
in the join ack); existing peers learn about them via `meeting:peer-joined` and only ever
answer. No two peers ever offer each other, so there is no negotiation collision to resolve.

**Quality ladder** (`lib/meshQuality.js`) — applied with `setParameters` on each video sender
and re-tuned as the room grows:

| Remote peers | Bitrate | Scale | Label |
|---:|---:|---:|---|
| ≤ 1 | 1.2 Mbps | 1× | 720p |
| ≤ 3 | 700 kbps | 1.5× | 480p |
| ≤ 6 | 350 kbps | 2× | 360p |
| 7+ | 180 kbps | 3× | 240p |

Per-stream, so five peers at 350 kbps is ~1.75 Mbps up rather than ~7.5 Mbps un-tuned.
`meshCapacityWarning()` surfaces an in-room warning past `MESH_COMFORTABLE_MAX = 6`.

**Reconnect** tears the whole mesh down and re-joins as a newcomer — the old socket id is dead,
so every peer keyed on it is unreachable.

---

## 9. SFU (LiveKit) path

`hooks/useLiveKitRoom.js`. Enabled per-deployment by `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`. `getMeetingRtc` mints a room token (`mtg_<meetingId>`) with a per-session
identity; LiveKit owns capture and publication (`setCameraEnabled`, `setMicrophoneEnabled`).

The knock/admit, chat, reactions, hand and host-control events **still run over our socket** —
LiveKit carries media only. That is why `RoomView` is shared: the SFU path swaps the transport,
not the product.

Two consequences worth knowing:

- Meeting-room events are keyed by **socketId on mesh and userId on SFU**, which is why several
  client handlers accept both. SFU tiles are per-user.
- **Background blur is not wired into the SFU path** — LiveKit owns the capture, so it needs a
  custom `LocalVideoTrack`. See §10.

---

## 10. In-meeting features

| Feature | Where | Notes |
|---|---|---|
| Mute / camera | both | `muteOnEntry` disables the mic for guests (never the host) |
| Screen share | both | `getDisplayMedia` → `replaceTrack` on every sender, so no renegotiation. Sets `presenterSid`; the room spotlights the presenter |
| In-meeting chat | both | Not persisted — relay only. Sender echoes optimistically |
| Reactions | both | Emoji burst, `.slice(0,8)`, sender excluded from the broadcast |
| Raise hand | both | Toggle, mirrored on every tile |
| Polls | both | Host creates/closes; anyone votes. Server-authoritative |
| Q&A | both | Anyone asks (optionally anonymous) and upvotes; host answers |
| Live captions | both | Browser speech recognition per participant, broadcast to everyone **except the speaker** (their UI already has the text). Appended to `transcript`, capped at 500 lines |
| Recording | both | **Local only** — see below |
| Background blur / virtual backgrounds | **mesh only** | MediaPipe selfie segmentation, self-hosted wasm. Swaps the outgoing track with `replaceTrack`, so it can be turned on mid-call without interrupting anyone. See §10.1 for what it needs to load |

### 10.1 What background effects need to load

Three things, and **all three have failed in practice** — each producing the same
unhelpful "background effects could not start", which is why the error now names the
actual cause:

1. **Both wasm variants must be served.** MediaPipe builds its own filename from a
   runtime SIMD feature test — `vision_wasm${simd ? '' : '_nosimd'}_internal.js` — so
   shipping only the SIMD pair breaks every browser (or CSP) where that test says no.
   `copy-mediapipe.mjs` stages all four files on `predev`/`prebuild`; `public/mediapipe/`
   is gitignored because it is a build artifact.
2. **The CSP must permit WebAssembly.** Chrome refuses to compile *any* wasm without
   `'wasm-unsafe-eval'` in `script-src`, including MediaPipe's own SIMD probe — which
   then reports "no SIMD" and requests the other filename. `client/vercel.json` grants it.
3. **`.wasm` must be served as `application/wasm`.** A wrong MIME type makes
   instantiation refuse the bytes.

**A missing asset does not 404.** The host rewrites unmatched paths to `index.html`, so
an absent file returns **200 with HTML**, and the runtime tries to execute HTML as
JavaScript. That is what made the original failure so opaque. `node test-video-effects.mjs`
(in CI) pins all of the above.

The GPU delegate is tried first and falls back to CPU — a VM or a locked-down driver
without WebGL2 is not a reason to have no blur at all.

### Recording is local, not cloud

`startRecording` composites every participant onto a 1280×720 canvas in a grid, mixes all
audio through a `WebAudioContext`, and records the result with `MediaRecorder` to a `.webm`
that **downloads to the host's machine** when they stop. `autoRecord` starts it on join.

There is no cloud copy and no shareable link, and nothing survives if the recording browser
dies. Closing the room finalizes the recorder first so the file downloads before the streams
are torn down.

---

## 11. Attendance and reporting

Written entirely by the socket layer:

- On `meeting:join`, once per socket: `Meeting.updateOne({startedAt: null}, {startedAt, status:'ongoing'})` and an `attendees` row is pushed with a **name/email snapshot** (so the report survives the account being deleted or renamed).
- On `meeting:leave` / `disconnect`: `finalizeAttendance()` `$inc`s that row's `durationSeconds`, sets `leftAt`, and sets `endedAt`. If the room is now empty, `ongoing → completed`.

`GET /api/meetings/:id/report` returns the record sorted by join time with per-attendee
duration. **Host only** — and `GET /api/meetings` strips `attendees` from every meeting you
don't host, leaving only `attendeeCount`.

---

## 12. Invitations

Creating or inviting fans out four ways, all best-effort and off the response path:

1. `meeting-invited` socket event → the meeting appears in their list with no reload.
2. A persisted `Notification` + Web Push, so it survives being offline.
3. An **email** with the join link.
4. An **`.ics` attachment** (`utils/ics.js`) — a `VEVENT` with UTC start/end and
   `METHOD:REQUEST`, so it lands properly in Google Calendar, Outlook and Apple Calendar.
   `recurrence` becomes an `RRULE:FREQ=…`.

Email addresses are validated, de-duplicated and **capped at 50** per call. `invitesQueued` in
the response is the count actually handed to the mailer — not the count you asked for.

### Two fields that are stored but do nothing

- **`reminderMinutes`** — saved, editable through `PATCH`, and **read by no job anywhere**. No
  reminder is ever sent. Either wire it to the scheduler or drop it from the UI.
- **`recurrence`** — reaches the calendar client correctly as an `RRULE`, so repeats show up in
  Google Calendar. But the app itself never creates the later instances: `GET /api/meetings`
  returns one row, and the room code is shared across every occurrence.

---

## 13. Client architecture

| Piece | Responsibility |
|---|---|
| `store/useMeetings.js` | REST only — `load`, `create`, `createInstant`, `rsvp`, `invite`, `getByCode`, `joinByCode`, `getReport` |
| `pages/MeetingsPage.jsx` | List, schedule, instant-meeting button, copy link, attendance report |
| `pages/MeetingRoom.jsx` | `/meet/:code`. Resolves the meeting → asks `/rtc` → mounts `MeshRoom` or `SfuRoom`, both rendering `RoomView` |
| `hooks/useMeetingRoom.js` | Mesh: peers, signalling, media, recording, effects, and every meeting socket event |
| `hooks/useLiveKitRoom.js` | SFU: same public surface, LiveKit-backed |
| `components/meeting/MeetingPollsPanel.jsx` | Polls + Q&A drawer |
| `components/meeting/CaptionOverlay.jsx` | Live caption lines |

`RoomView` takes whichever hook's return value it is given, so the two transports cannot drift
apart in the UI.

---

## 14. Configuration

| Variable | Effect |
|---|---|
| `CLIENT_URL` | Builds `link` (`/meet/<code>`) in invitation emails. A stale value mails everyone a dead link |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | All three set ⇒ SFU. Otherwise mesh |
| `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | TURN relay. **Without it, calls between different NATs connect and then drop** |
| Email (`BREVO_API_KEY` or `EMAIL_*`/`SMTP_*`) | Unset ⇒ invitations are logged, not sent |

---

## 15. Tests

| Suite | Checks | Covers |
|---|---:|---|
| `meeting-mesh.mjs` | 28 | a 3rd/4th joiner sees everyone already in the room |
| `meeting-room-realtime.mjs` | 12 | join, chat, hand, reactions, host controls |
| `meeting-collab-realtime.mjs` | 24 | polls, Q&A, captions, knock/deny |
| `meeting-visibility.mjs` | 20 | who can see a meeting, and the `/rtc` admission gate |
| `meeting-invites.mjs` | 15 | invite dedup/validation, `.ics`, absolute join link |

---

## 16. Known gaps

- **No cloud recording** — local `.webm` download only (§10).
- **No breakout rooms, no whiteboard.**
- **Background blur is mesh-only** (§9).
- **`reminderMinutes` does nothing** (§12).
- **`recurrence` doesn't generate instances** (§12).
- **No dial-in / PSTN**, no live streaming to a view-only audience.
- **Meeting chat isn't persisted** — it exists only for the duration of the room.

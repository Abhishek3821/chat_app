# ChatKonect Meeting Developer Guide

Updated: 15 October 2026 | Audience: application, frontend, backend and QA developers

Implementation reference for the current working tree. Examples use placeholder origins, identities and tokens. No environment secrets are included. This guide describes code behavior; it is not a certification of a deployed server or every browser/device combination.

## 1. Scope and navigation

This handoff covers the complete meeting journey: discovery, instant and scheduled creation, invitations, RSVP, reminders, device checks, passwords, admission, media, room collaboration, host controls, notes, reports, embedded integration, operation and testing.

Reading order: sections 2-4 explain features and permissions; sections 5-11 define HTTP and realtime integration; sections 12-16 cover media, persistence and infrastructure; sections 17-20 cover known gaps, QA, troubleshooting and source ownership.

The supported implementation is a React web client with an Express/MongoDB API, Socket.IO signaling and either browser WebRTC mesh or LiveKit media. A Flutter, Android or iOS client must implement the same HTTP/session/admission contracts and choose a compatible media stack. The repository does not supply a native mobile meeting SDK.

## 2. Complete feature inventory

### Planning and meeting discovery

- Instant video meeting: Start now creates a shareable room and opens it immediately. The API also accepts audio instant meetings.
- Scheduled audio or video meeting: title, date/time, contact invitations, email invitations, optional password, repeat selection, reminder selection and entry policy.
- Meeting list: upcoming, past and all tabs; seven-day date strip; grouping by day; grid/list view persisted under `cc_meetings_view`; meeting status, host, participant avatars, type and recurrence label.
- Join using a link, room code or raw MongoDB meeting ID. Copy ID and copy link are separate actions.
- RSVP: going, maybe or not going. Stored invitations begin as pending.
- Add more invitees after creation. The host sees added, already invited, unreachable and queued-email counts.
- In-app invitation and reminder events, persisted notifications and optional email delivery.
- Host edit and cancellation endpoints exist. Do not assume every editable API field has a dedicated control on the current screen.

### Before entry

- Camera preview; microphone and camera selection; system-default devices.
- Microphone level meter and speaker test tone.
- Background noise suppression preference, echo cancellation and automatic gain control.
- Optional meeting password; the host bypasses the password prompt.
- Wait for host when join-anytime is disabled.
- Ask-to-join lobby for people who were not explicitly invited; host admit/deny controls; waiting duration and admission feedback.
- Locked-room rejection, cancelled/unknown meeting handling and mesh capacity rejection.

### Inside the room

- Audio/video tiles, avatar fallback, mirrored local camera, participant count, connection state and network quality.
- Microphone mute/unmute and camera on/off.
- Screen sharing, local share preview, presenter spotlight and participant thumbnail strip; return to tiles when sharing stops.
- Landscape/portrait tile layout and fullscreen where supported.
- In-room text chat, unread badge and chat drawer.
- Emoji reactions, floating tile reactions and raised hands.
- Ordered host hand queue and host lowering of another participant's hand.
- Poll creation, single/multiple choice voting, live results, re-voting and poll closure.
- Q&A submission, optional anonymous display, upvote toggle and host answer/mark answered.
- Shared editable notes, version-conflict detection and notes-to-team-task action.
- Local recording with download on stop/leave; automatic local recording policy.
- Host mute-all, individual mute requests and participant removal.
- Live host policies: lock/unlock, enable/disable participant chat and enable/disable participant screen sharing.
- Mobile More controls sheet for reactions, recording and tile shape; overlays for side panels on smaller screens.
- Leave and cleanup, mesh reconnect/ICE recovery, best-effort attendance and completion tracking.
- Incoming direct calls are treated as busy while the meeting page is active.

### After the room

- Host-only attendance report, actual start/end and duration, attendee count and attendance rows.
- Report includes poll results, Q&A, recent reaction history and shared notes.
- Client-side CSV attendance export with spreadsheet-formula escaping.
- Persisted meeting records remain available in the list; cancellation marks a record cancelled rather than deleting it.

### Breakout support status

The Create 2 breakouts, Create 3 breakouts and Create 4 breakouts buttons have been removed from the current meeting UI. Their creation handler and busy state were also removed. The backend create/list/end endpoints, assigned-room admission, join invitation, return-to-main flow and existing-room links remain implemented. Treat creation as an API capability that is currently hidden in the first-party screen.

## 3. Architecture and identifiers

The React room page resolves the room, shows device checks, registers link participation and asks the API for transport configuration. Both media hooks feed the same room UI. Chat, polls, Q&A, hands, attendance and admission continue to use ChatKonect Socket.IO even when media uses LiveKit.

| Identifier | Example shape | Purpose |
|---|---|---|
| Meeting ID | 24-character MongoDB ObjectId | REST id routes and every meeting socket payload |
| Room code | abc-defg-hij | Shareable `/meet/:code` route; generated with unambiguous characters |
| Socket room | mtg:MEETING_ID | Server coordination room |
| LiveKit room | mtg_MEETING_ID | SFU media namespace |
| Mesh participant key | Socket.IO socket ID | Peer connection and tile identity |
| SFU participant key | User ID in UI | Derived from LiveKit identity USER_ID_random |

A room code is not an access token. HTTP meeting routes require a signed-in session. Socket admission is a separate step after HTTP join. A successful HTTP join must never be shown as proof that the user has been admitted to live media.

## 4. Authentication, roles and permissions

Use the normal user access token in `Authorization: Bearer USER_ACCESS_TOKEN`, or the supported first-party session cookie. Access tokens refer to a tracked session via `sid`; account status, token version and session validity are checked. Socket.IO accepts `auth.token` or a Bearer header. Workspace guest accounts cannot open the meeting socket surface.

| Action | Host | Other signed-in user |
|---|---|---|
| Create a meeting | Yes | Yes, becomes host of new meeting |
| List meetings | Own/invited/link-registered | Own/invited/link-registered |
| Read summary with code | Yes | Yes; assigned users only for breakouts |
| Join live room | Yes | Password, lobby, lock and capacity gates apply |
| Edit, cancel, invite others | Yes | No |
| RSVP | Yes | Existing participant only |
| Start/close polls, answer Q&A | Yes, while in room | No |
| Vote, ask, upvote, react, raise hand | Yes | Admitted room member |
| Chat/screen share | Yes | Subject to host policy and media support |
| Mute/remove/lower others' hands | Yes, while in room | No |
| Read/edit notes | Yes | Recorded attendee, including after leaving |
| Read detailed attendance report | Yes | No |
| Create/end breakouts through API | Yes | No |

The `/api/meetings` router applies `requireFeature('meetings')` for embedded app users. First-party accounts are not app-feature gated. Invitations resolve users inside the caller's app tenant; ordinary workspace differences do not exclude a reachable invitee. See section 17 for enforcement gaps to review when building a custom client.

## 5. REST API reference

All paths below are relative to the API origin, normally `https://api.example.com`. Send JSON with `Content-Type: application/json` for bodies. Success envelopes contain `success: true`; operational errors use a message and an appropriate HTTP status.

| Method | Path | Result / access |
|---|---|---|
| GET | /api/meetings | Top-level meetings for current host/participant |
| POST | /api/meetings | Create instant or scheduled; 201 |
| GET | /api/meetings/code/:code | Prejoin summary; code or raw ID |
| POST | /api/meetings/code/:code/join | Register participation and verify password |
| GET | /api/meetings/code/:code/rtc | Mesh/SFU selection and admission-aware SFU token |
| PATCH | /api/meetings/:id | Host edit |
| POST | /api/meetings/:id/invite | Host adds contacts/emails |
| POST | /api/meetings/:id/rsvp | Existing participant response |
| DELETE | /api/meetings/:id | Host cancellation |
| GET | /api/meetings/:id/report | Host-only report |
| GET | /api/meetings/:id/notes | Host or recorded attendee |
| PUT | /api/meetings/:id/notes | Versioned notes update |
| POST | /api/meetings/:id/breakouts | Host create 2-4 rooms; 201 |
| GET | /api/meetings/:id/breakouts | Host sees all; others see assigned rooms |
| DELETE | /api/meetings/:id/breakouts | Host ends active child rooms |

### Create and schedule

Omit `startAt` for an instant room: status is ongoing, time is now, and an omitted/blank title becomes Instant meeting. Providing `startAt` creates scheduled status. A room code/link is generated; allocation retries up to five attempts on duplicate-key collisions.

```json
{
  "title": "Product review",
  "description": "Decisions and next steps",
  "startAt": "2026-10-20T09:30:00.000Z",
  "timezone": "Asia/Kolkata",
  "durationMinutes": 30,
  "type": "video",
  "participants": ["INVITEE_USER_ID"],
  "inviteEmails": ["developer@example.com"],
  "recurrence": "none",
  "reminderMinutes": 10,
  "password": "EXAMPLE_ONLY_123",
  "settings": {
    "joinAnytime": true,
    "askToJoin": true,
    "muteOnEntry": false,
    "autoRecord": false
  }
}
```

The result is `{ success: true, meeting, invitesQueued }`. `participants` contains ChatKonect user IDs, not partner external IDs or emails. The host is removed from requested invitees, IDs are deduplicated and unreachable tenant users are omitted. `chatId` is an optional associated chat reference. Type is audio or video; recurrence is none, daily, weekly or monthly. Password is optional and, when truthy, must be a string of 6-72 characters; it is hashed with bcrypt cost 12.

Schema limits: title 120 characters, description 1,000, notes 20,000. Duration defaults to 30 minutes, timezone to UTC, reminder to 10 minutes and type to video. Timezone input is capped to 64 characters. Supply correctly typed booleans: settings sanitization uses Boolean conversion, so a string such as `"false"` is truthy.

### List, edit and cancel

GET returns `{ success: true, meetings }`, sorted by start time and excluding child breakout records. Each item includes attendeeCount and durationSeconds. List responses remove notes; non-host list responses also remove detailed attendees.

PATCH accepts only title, description, startAt, durationMinutes, timezone, type, recurrence and reminderMinutes, plus whitelisted settings. It cannot reassign host, participants, chat, link or status. Updating startAt/reminderMinutes resets reminderSentAt. Settings changes broadcast `meeting:policy` to the socket room. No password-edit route is implemented here.

DELETE sets status to cancelled and returns `{ success: true }`. Subsequent code lookup/join returns 410. It does not implement an immediate live End meeting for everyone command.

### Invitations and RSVP

```json
{
  "userIds": ["ANOTHER_CHATKONECT_USER_ID"],
  "emails": ["invitee@example.com"]
}
```

POST invite returns meeting, added user summaries, skipped, alreadyInvited, unreachable and invitesQueued. Empty input is 400, non-host is 403, missing meeting is 404 and cancelled meeting is 409. Raw emails receive the shareable link but do not become participant rows automatically. A recipient still signs in and follows admission rules. Email queuing validates/deduplicates addresses and caps each call at 50 unique valid addresses; queued does not mean delivered.

RSVP body is `{ "response": "going" }`; going, maybe and not_going are the only accepted values. A user without a participant row cannot add themselves via RSVP. The host may RSVP too.

### Summary and password join

GET code returns a restricted meeting summary: _id, title, type, status, startAt, timezone, roomCode, host, settings, hasPassword and isHost. POST join body is `{ "password": "EXAMPLE_ONLY_123" }` or `{}`. The response is `{ success: true, meeting, passwordPass }`.

New link joiners are stored with response going and viaLink true. Explicit invitations have viaLink false, so registration through a shared link does not bypass ask-to-join. A passwordPass is a signed meet-password token bound to this user and meeting, valid for four hours; send it to socket join and RTC requests. Do not expose password hashes or treat this scoped pass as a login token.

### RTC configuration

GET `/api/meetings/code/:code/rtc` accepts query parameters `pass` and `passwordPass`. The admission pass has scope meet-admit and lasts 15 minutes. The password pass and admission pass have separate purposes; both can be necessary.

```json
{ "success": true, "enabled": false }
```

This selects mesh. With LiveKit configured, an authorized result contains enabled true, url, token and room. A waiting/unadmitted response contains enabled true and requiresAdmission true with no usable media token. Connect to LiveKit only after socket admission and receipt of a real token. Tokens last three hours and use a per-connection identity; the host token has roomAdmin true.

## 6. Recommended join state machine

1. Obtain a valid end-user session, load the summary and show a device check. Retain the original code or raw ID.
2. POST join with the password if required. Save the returned meeting ID and passwordPass in memory.
3. GET RTC configuration. Prepare the chosen media implementation; do not connect to SFU without a token.
4. Open the authenticated Socket.IO connection and register event listeners before emitting meeting:join.
5. Send meetingId, optional pass and passwordPass. Handle the acknowledgment flags below.
6. If admitted, initialize peers from the acknowledgment or connect the SFU. Seed polls/questions from the acknowledgment.
7. If waiting, retry using the existing client strategy; if knocking, wait for admitted/denied. After admitted, retry join with the signed pass and re-fetch RTC config with both passes.
8. On leave/unmount, stop local recording, remove listeners, emit leave, close peer/SFU connections and stop media tracks.

```js
const socket = io(API_ORIGIN, { auth: { token: userToken } });
let admissionPass;
const join = () => socket.emit('meeting:join', {
  meetingId, pass: admissionPass, passwordPass
}, ack => {
  if (ack.ok) return onJoined(ack);
  if (ack.full) return showRoomFull(ack.limit);
  if (ack.waiting) return showWaitingForHost();
  if (ack.knocking) return showAdmissionPending();
  showJoinError(ack.error);
});
socket.on('meeting:admitted', event => {
  if (String(event.meetingId) !== String(meetingId)) return;
  admissionPass = event.pass;
  join();
});
socket.on('meeting:denied', event => {
  if (String(event.meetingId) === String(meetingId)) showDenied();
});
socket.on('connect', join);
```

This is coordination pseudocode, not a complete media client. Implement the helper callbacks, media initialization, token renewal, reconnect policy and listener teardown. The meetingRoom hooks in the repository are the fuller reference.

## 7. Socket.IO client-to-server contract

All events below use the authenticated socket. Most actions require an admitted socket in `mtg:meetingId`; host actions additionally check cached host identity. Except join, handlers generally ignore invalid actions without returning an acknowledgment. Do not invent success callbacks for them; watch the authoritative broadcast.

| Event | Payload besides meetingId | Purpose |
|---|---|---|
| meeting:join | pass?, passwordPass? | Join acknowledgment and roster |
| meeting:signal | to, data | Mesh SDP/ICE relay |
| meeting:presenting | on | Mesh share announcement |
| meeting:chat | text | Room text, trimmed to 2,000 chars |
| meeting:reaction | emoji | Burst, string capped at 8 chars |
| meeting:hand | up | Raise/lower own hand |
| meeting:lower-hand | to | Host lowers matching socket/user hand |
| meeting:poll-create | question, options, multi | Host starts poll |
| meeting:poll-vote | pollId, choices | Replace own ballot |
| meeting:poll-close | pollId | Host closes poll |
| meeting:qa-ask | text, anonymous | Submit question |
| meeting:qa-upvote | questionId | Toggle own upvote |
| meeting:qa-answer | questionId, answerText? | Host marks/answers |
| meeting:admit | socketId, userId, allow | Host admission verdict |
| meeting:mute-all | None | Host asks others to mute |
| meeting:force-mute | to or toUser | Host asks one target to mute |
| meeting:remove | to or toUser | Host removes matching socket(s) |
| meeting:leave | None | Leave and finalize attendance |

Successful join acknowledgment: `{ ok: true, peers, isHost, polls, questions }`. Peer rows include socketId, userId, name, avatar and handRaisedAt. Failure acknowledgment: ok false, error, and optionally waiting, knocking, or full plus limit. A cancelled/missing meeting is unavailable. Capacity is checked before waiting/knocking; a full mesh room should not leave the user stuck waiting for admission.

Mesh signal data uses `{ kind: 'offer', sdp }`, `{ kind: 'answer', sdp }` and `{ kind: 'ice', candidate }`. The newcomer offers to each existing peer; existing peers answer. Buffer ICE until remoteDescription exists. Use socket IDs, not user IDs, as mesh destination keys.

## 8. Socket.IO server-to-client contract

| Event | Main fields | Client handling |
|---|---|---|
| meeting:peer-joined | socketId, userId, name, avatar | Update roster; prepare to answer newcomer |
| meeting:peer-left | socketId | Remove tile and close peer |
| meeting:signal | from, data | Apply SDP/ICE |
| meeting:presenting | socketId, on | Update mesh presenter |
| meeting:chat | socketId, userId, name, avatar, text, at | Append message |
| meeting:reaction | socketId, userId, name, emoji | Transient animation |
| meeting:hand | socketId, userId, up, at; name on own-hand relay | Update queue/tiles |
| meeting:lower-hand | meetingId | Lower own local hand |
| meeting:polls | polls | Replace entire poll state |
| meeting:questions | questions | Replace entire Q&A state |
| meeting:knock | meetingId, socketId, userId, name, avatar, knockedAt | Host admission prompt |
| meeting:admitted | meetingId, pass | Retry admission with pass |
| meeting:denied | meetingId | Show rejection |
| meeting:knock-handled | meetingId, socketId | Clear prompt in another host tab |
| meeting:force-mute | by, all? | Disable local microphone |
| meeting:removed | by | Exit and release media |
| meeting:policy | settings | Refresh live controls |
| meeting:breakout-invite | meetingId, roomCode, title | Offer assigned-room join |
| meeting:breakout-return | roomCode | Navigate back to main room |
| meeting-invited | meetingId, title, startAt | Reload invitation/list state |
| meeting-reminder | meetingId, title, startAt | Show upcoming reminder |
| meeting-notes | meetingId, notes, updatedAt | Apply version if no dirty edits |

Room broadcasts often do not contain meetingId. Keep listeners tied to the current mounted room and unregister them before navigating. Chat, reactions and own hand changes use local optimistic feedback because broadcasts normally exclude the sender. Polls and questions include the sender and replace full arrays. Event names with a hyphen, such as meeting-notes, must not be rewritten with a colon.

## 9. Polls, Q&A and room interaction

Poll question text is capped at 300 characters. Options are trimmed, blanks removed, capped at 120 characters each, and limited to 10; at least two are required. Only the host may create/close. Choices are distinct numeric option indexes. Single-choice polls keep the first valid choice. Closed polls, empty ballots and out-of-range choices are ignored. Re-voting replaces the caller's previous row. Derive tally from votes, not a separate client counter. A participant cannot clear a ballot by sending an empty array. Late joiners receive existing state in the join acknowledgment.

Q&A text is trimmed and capped at 500 characters. Anonymous mode omits askedByName but still stores askedBy; do not promise identity-proof anonymity. Upvote toggles the caller's user ID in upvotes. Only the host can mark answered; optional answerText is trimmed/capped at 2,000 characters. The report preserves questions and answers.

Raised hands are transient per-socket state. The join roster includes handRaisedAt so late joiners can reconstruct the queue. The UI sorts by time; the host can lower another hand. Reactions are transient on-screen and also persisted as a capped history of the latest 200 reactions.

Room text is relayed, not stored in a meeting-chat collection. Reloading/rejoining does not restore chat history. Participant chat policy is checked in the server handler; the host can still chat. Host mute actions request the target client to disable its microphone; they do not constitute server-side media enforcement.

## 10. Shared notes and team action items

GET notes returns `{ success: true, notes, updatedAt }`. PUT sends the current text and the exact previously returned version; use null for the initial version.

```json
{
  "notes": "Decision: ship the reviewed change. Owner: team.",
  "updatedAt": null
}
```

Only the host or a user in the recorded attendees array may read/edit notes. This is historical attendance access, not an invitation-only check or proof that the user is still live. Text length must be at most 20,000 characters. A stale version returns 409; preserve the draft, reload and let the user reconcile rather than silently overwriting.

Successful updates return a new updatedAt and send meeting-notes to the host and each recorded attendee's user room. The panel applies remote updates only when clean; dirty editors see a conflict notice. This is explicit save/reload collaboration, not a character-level collaborative editor.

In a team workspace, Create task prompts for a title and POSTs `/api/workspaces/me/tasks` with title, notes sliced to 3,000 characters as description, and `source: { kind: 'meeting', id: meetingId }`. Save notes before creating the task. Task permissions are governed by the workspace endpoint as well as UI visibility.

## 11. Attendance, report and CSV export

The first successful socket join stamps startedAt if absent and marks the meeting ongoing. An attendee row is inserted once per user with user ID, name/email snapshots and first joinedAt. Each socket tracks its own join time. Leave/disconnect accumulates durationSeconds and writes leftAt/endedAt. When the room becomes empty, ongoing status becomes completed. These writes are best effort and do not block media on every database failure.

GET report returns `{ success: true, report }`. Report includes _id, title, type, host, status, scheduledAt, timezone, startedAt, endedAt, durationSeconds, attendeeCount, attendees, polls, questions, reactionHistory and notes. Attendee rows contain name, email, joinedAt, leftAt and durationSeconds, ordered by first join. Unauthorized report access is 403.

The report UI shows meeting/attendance statistics, poll choices and tallies, reaction activity and attendance rows. The report API also returns Q&A and notes, although the current report modal does not render dedicated sections for those fields. Export is generated in the browser as `meeting-attendance-MEETING_ID.csv`; it is not a separate export API. Columns are Name, Email, Joined, Left and Duration (seconds). Fields are CSV-quoted and cells beginning with formula-like prefixes are escaped.

Attendance is not billing-grade: overlapping tabs can add overlapping duration; leftAt is not cleared on every rejoin; endedAt is updated as sockets leave, including before everyone has left. Report duration is based on the stored first start and latest end and may be stale during a live meeting. The list's non-host privacy filtering does not automatically establish privacy for every other populated meeting response; review section 17.

## 12. Media transport and browser behavior

### Mesh

Without all three LiveKit variables, RTC config selects peer-to-peer mesh. The current room selector also falls back to mesh if the RTC HTTP fetch fails. Each browser establishes a separate RTCPeerConnection per remote socket. Media is direct where possible and otherwise relayed through TURN. Newcomers offer; existing peers answer. Initial media acquisition can fall back to audio-only or an empty stream when devices are denied, allowing coordination to continue. Selected device IDs and noise preference are applied at acquisition.

Video encoding is retuned when peer count changes: at most 1 remote uses 1,200,000 bps and scale 1; up to 3 uses 700,000 and scale 1.5; up to 6 uses 350,000 and scale 2; larger uses 180,000 and scale 3. These are encoder targets, not guaranteed delivered quality. UI warns above six total participants and has a fixed hard-warning threshold of nine. The server default admission limit is nine, configurable by MESH_MAX_PARTICIPANTS, clamped to 2-50. The host and SFU deployments bypass the mesh cap. The count is live sockets, so multiple tabs consume seats.

On an ICE failure, the original offerer attempts an ICE restart. A peer that remains failed is closed after approximately 10 seconds. Socket reconnect rebuilds mesh connections and re-announces an active screen share. Network quality sampling runs every five seconds and uses connection state and successful-candidate RTT; an RTT over 0.3 seconds is labeled Poor.

### LiveKit SFU

Configure LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET on the backend before starting it. Credentials are read when the module loads. Media uses LiveKit while ChatKonect sockets continue admission, attendance and collaboration. The room enables adaptiveStream and dynacast. Do not apply the mesh nine-person limit as an SFU product limit; actual capacity depends on deployment resources and network operation.

The hook joins the socket room before connecting media. If the RTC response requires admission, it waits for the admission pass and requests a real token. SFU remote streams prefer screen over camera. UI keys are derived from user IDs; same-user multiple LiveKit identities can collapse into one UI identity. Connection quality uses LiveKit events. Media failure/reconnection behavior must be tested separately from a Socket.IO reconnect.

### Screens, devices and layout

Screen sharing is exposed for video meetings, requires a supported browser and user gesture, and may be unavailable in mobile browsers/webviews. Mesh uses getDisplayMedia at a requested 30 fps with audio false, replaces the outbound camera track and restores it on stop. SFU uses the LiveKit screen-share API. Do not promise tab/system audio capture. The current implementation has no in-room device-switch menu; selected devices come from the prejoin check.

The room spotlights a presenter, keeps a thumbnail strip, supports portrait/landscape tiles, and uses fullscreen only if the browser exposes it. Phones move secondary controls to More. Fullscreen/clipboard failures have limited fallbacks. Speaker test plays a local tone; it is not an output-device selector. Audio processing uses browser constraints, not AI transcription or server audio enhancement.

### Local recording

Recording composites video using a 1280x720 canvas and mixes audio in the browser. The resulting WebM downloads on stop or leave. Both media transports provide local recording; the SFU uses the meetingRecorder helper. Auto-record starts a local recorder on each joining device where supported. It is not a server recording or one shared recording for the host.

No recording upload/list/download API, cloud archive, transcription, captions or recording-consent broadcast is implemented in these meeting files. Recording depends on browser MediaRecorder/AudioContext support, available resources and download behavior. In mesh, audio inputs are attached at recorder startup, so audio from later joiners is not guaranteed to enter the existing mix; screen composition also differs from the live presenter layout. Test this explicitly before relying on exported recordings.

## 13. Breakout API contract

POST breakout body is `{ "count": 2 }`; count must be an integer 2-4. Only the main meeting's host can create. Existing active breakouts cause 409. There must be at least count distinct non-host users currently in the main socket room; otherwise creation returns 400.

Users are deduplicated by user ID and distributed round-robin. Child rooms inherit host/type, use joinAnytime true and askToJoin false, and inherit muteOnEntry. Each gets parentMeeting and parentRoomCode. The response is `{ success: true, rooms }` with id, roomCode, title and assigned participant names. Assignment emits meeting:breakout-invite to each user.

GET returns non-cancelled child rooms; the host sees all and participant IDs, while other callers see only rooms assigned to them. A parentMeeting record cannot be used as the main listing target. Code/HTTP join/SFU/socket admission reject users not assigned to a child room, except its host.

DELETE emits meeting:breakout-return to child socket rooms, then marks children cancelled. The UI can navigate back using the parent's room code. This is not automatic server ejection from an SFU room. Since creation buttons are removed, retain this section for existing integrations and future product decisions rather than reintroducing the buttons.

## 14. Data model and lifecycle

The Meeting collection stores title, description, host, participants, chat, parentMeeting, parentRoomCode, startAt, durationMinutes, timezone, type, roomCode, link, hasPassword, passwordHash, settings, recurrence, reminderMinutes, status, startedAt, endedAt, attendees, polls, questions, reactionHistory, notes, notesUpdatedAt, reminderSentAt and normal timestamps.

Participant fields are user, response and viaLink. Settings default to joinAnytime true, muteOnEntry false, autoRecord false, askToJoin true, locked false, allowChat true and allowScreenShare true. Status enum is scheduled, ongoing, completed or cancelled. Participant response enum is going, maybe, not_going or pending. Poll votes store user plus choices; Q&A upvotes store user IDs.

Room code is uniquely indexed. Host, participant-user and start-time indexes support lookups. passwordHash is excluded by default selection; join explicitly selects it for verification. Avoid serializing a document selected with passwordHash into client responses.

Lifecycle: creation sets scheduled or ongoing; first successful socket attendance sets ongoing if startedAt was null; last leaving socket can set completed; host cancellation sets cancelled. Completed status is not treated like cancellation by the join gates, so re-entry is not prohibited. Scheduled duration is planning metadata and UI grouping input, not an enforced countdown or room expiry. No recurrence worker creates future instances in the inspected code.

## 15. Reminders and email delivery

The reminder dispatcher starts with the server and runs every 30 seconds, including an initial run. It finds at most 100 scheduled meetings in the next hour that have no reminderSentAt. Threshold minutes are clamped to 1-60, with default 10. An atomic claim sets reminderSentAt before dispatch to avoid duplicate claims across instances.

Recipients are the host plus participants whose response is not not_going. Each receives meeting-reminder and notifyUser processing. Delivery is notification-based, not a scheduled reminder email in this utility. Raw-email-only invitees have no user record to receive these in-app reminders. A failed send after the claim does not have a documented per-recipient retry here.

Invitation emails are separate and best effort. Configure BREVO_API_KEY or the supported EMAIL_HOST, EMAIL_USER, EMAIL_PASS mailer setup. Use the application's actual email configuration reference for additional transport settings. CLIENT_URL controls the generated meeting URL. Invitation time uses the stored timezone; invalid formatting falls back to UTC text. Logs distinguish queued-but-unconfigured, delivered-to-mailer and categorized send errors. Do not claim inbox delivery from invitesQueued.

## 16. App embedding, native integration and deployment

### Hosted web UI integration

Enable meetings in the tenant app configuration and allow the partner origin. Provision users and mint a session on the partner backend using X-CC-App-Id plus the app secret: POST `/api/v1/platform/users`, then POST `/api/v1/platform/tokens`. Keep app secrets on that backend. Return only the end-user token and expiry to the host frontend. Personal X-API-Key access acts as its owner and is a different integration.

```js
const meetings = ChatKonect.mount({
  el: '#meeting-container',
  appId: 'APP_ID_PLACEHOLDER',
  initialPath: '/meetings',
  getToken: async () => {
    const response = await fetch('/chat-token', {
      credentials: 'same-origin', cache: 'no-store'
    });
    if (!response.ok) throw new Error('Sign-in required');
    return response.json();
  }
});
// Open a known destination after mounting:
meetings.navigate('/meet/ROOM_CODE');
```

Load embed.js from your ChatKonect frontend origin first, and provide a container with an explicit height. The React package also supports initialPath; the repository's packages are supplied locally, not assumed published. On host logout/account change, destroy the old frame and remount with the new identity. Shared links use the host page's chatkonectPath query parameter; preserve it through login. Consult DEVELOPER_INTEGRATION.md for full identity and host lifecycle examples.

The loader delegates camera, microphone, display-capture, autoplay, clipboard-write and fullscreen. The parent Permissions-Policy must also permit the ChatKonect origin. Serve both host and frontend over HTTPS; localhost development differs from plain HTTP on a LAN IP. Browser permission, autoplay and mobile restrictions still apply. Embedded session transport uses origin-checked postMessage/Bearer tokens rather than relying on third-party cookies.

### Custom and native clients

Use the documented end-user API, socket admission and chosen media transport; neither a room code nor a personal API key is a substitute for per-user login. `/api/v1/meetings` provides legacy personal-key list/create with meetings:read or meetings:write; it is not a complete native meeting API. For SFU, use a compatible client only after receiving an admitted token. For mesh, implement SDP/ICE, media permissions, peer cleanup, device routing and recovery. Native backgrounding, push, audio focus and webview device permissions are additional platform work, not supplied here.

### Backend and infrastructure settings

| Variable | Purpose | Location |
|---|---|---|
| MONGO_URI | Meeting/session persistence | Backend secret/config |
| JWT_SECRET | Session and scoped-pass signing | Backend secret |
| CLIENT_URL | Generated shareable frontend links | Backend config |
| LIVEKIT_URL | SFU websocket origin | Backend config |
| LIVEKIT_API_KEY | SFU token signer identity | Backend secret |
| LIVEKIT_API_SECRET | SFU token signer secret | Backend secret |
| MESH_MAX_PARTICIPANTS | Mesh admission cap, default 9 | Backend config |
| TURN_URL, TURN_SECRET | Self-hosted coturn credential generation | Backend secrets/config |
| METERED_SUBDOMAIN, METERED_API_KEY | Optional managed TURN | Backend config/secret |
| CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN | Optional managed TURN | Backend secrets |
| REDIS_URL | Optional multi-instance coordination/cache | Backend secret/config |
| BREVO_API_KEY or EMAIL_HOST/USER/PASS | Invitation email transport | Backend secrets/config |

The browser loads temporary ICE entries from `/api/auth/turn-credentials`; partner-facing ICE configuration is also available through `/api/v1/ice` under its own route authentication. Provider preference in code is self-hosted coturn, Metered, then Cloudflare, with STUN entries also present. Do not embed long-lived TURN/provider secrets in VITE variables. A credential response does not prove relay reachability: verify allocation with the supplied relay checker and test Wi-Fi-to-mobile media.

For multiple API instances, preserve Socket.IO routing/adapter behavior and shared session/meeting persistence. Host presence, peers, capacity and moderation use fetchSockets across the adapter. Configure deployment origins and proxy/websocket forwarding using the existing deployment guides. Changing LiveKit module-loaded settings requires backend restart. No numeric SFU capacity guarantee is provided by this repository.

## 17. Current limitations and implementation review items

These are observed in the current source, separated from intended product behavior. They are relevant to a developer handoff and were not changed as part of writing this document.

- Recurrence is saved and displayed, but no occurrence-generation worker was found. Daily/weekly/monthly selection does not itself schedule a series.
- The schedule modal passes reminderMinutes, but useMeetings.create does not accept or forward that field. The normal scheduling flow therefore uses the backend default of 10 minutes even when 5 or 30 is selected. Direct API callers can set it.
- REST invitations apply tenantScope, but code lookup/join and socket admission do not perform an explicit same-app meeting ownership check. The socket handshake does not apply requireFeature('meetings'). Review cross-tenant code possession/capability enforcement before treating this as a hardened custom-client boundary.
- List responses hide detailed attendees for non-hosts; populated join/edit/RSVP/invite responses do not use the same explicit sanitization. Review response fields before relying on host-only attendance privacy across all endpoints.
- Anonymous Q&A hides the name but broadcasts stored question objects containing askedBy. It is anonymous presentation, not anonymity from a developer inspecting the payload.
- Host mute is client cooperation. Remove sends an event and removes socket-room membership, but does not persist a ban or explicitly revoke a LiveKit participant; re-entry can be possible. Treat SFU server-enforced moderation as additional work.
- Screen-share policy hides controls and gates the mesh presentation announcement, but does not prevent a modified mesh client from sending a video track or change SFU publish grants. Existing live shares are not guaranteed to stop when the toggle changes.
- Mesh signaling checks the sender's room membership but does not independently prove the destination socket is in that same room. Custom-client deployments should review destination authorization.
- Cancellation changes database status and future admission behavior; it does not broadcast an end-for-everyone event or immediately stop existing media. Host departure alone does not end a room that still has participants.
- Room status, attendance writes and reminders have the best-effort behavior described earlier. Re-entry into completed records and overlapping-tab durations need an explicit product policy if strict lifecycle/accounting is required.
- Full-array poll/Q&A updates use document read-modify-save; concurrent writes need contention testing. UI reset after a socket emit is not proof of successful persistence.
- Notes are shared with historical attendees, not just currently admitted users; task creation is limited to the team workspace integration.
- SFU same-user multi-tab UI, local recording of later joiners, long sessions exceeding scoped/token lifetimes and permission-denied SFU entry need dedicated device tests.
- UI has no captions, transcription, virtual background, cloud recording archive, calendar-provider sync, co-host transfer or explicit end-for-everyone feature in the inspected meeting implementation.

## 18. QA and acceptance checklist

The documentation task does not rerun destructive/resetting integration suites. Several existing tests derive and drop fixed test databases from MONGO_URI. Read each suite and point it at an approved isolated environment before execution; do not point tests at application data.

Existing suites: meeting-visibility.mjs, meeting-invites.mjs, meeting-mesh.mjs, meeting-room-realtime.mjs, meeting-collab-realtime.mjs, meeting-capacity.mjs and turn-relay.mjs under server/tests. They cover API visibility/invites, signaling/roster, moderation/collaboration, admission and capacity, with different levels of media simulation. Their existence is not evidence that all currently pass. Tests should be run from server as documented in their headers.

1. Create instant audio/video and scheduled meetings; verify title, timezone, room code uniqueness, defaults, optional password and repeat/reminder behavior against section 17.
2. Invite contacts across ordinary workspace boundaries; reject unavailable tenant identities; verify duplicate/unreachable/queued counts and raw-email sign-in behavior.
3. Check upcoming/past/all, date filters, view persistence, list sorting, RSVP and host cancellation/edit permissions.
4. Test no session, revoked session, banned/suspended account, guest workspace account, disabled meetings capability and another app's room code.
5. Join by code, full URL and raw ID. Check missing/cancelled rooms, incorrect password, valid/expired password pass, waiting host, invited bypass, knock, admit, deny and expired admission pass.
6. Verify device selection, mic meter, speaker tone, noise toggle, permission denial, unplugged devices and browser/device fallback in both transports.
7. Test three or more people: newcomer roster, every media direction, late join, sender-only local echo, tile cleanup, rejoin and hand queue reconstruction.
8. Verify chat policy, 2,000-char text, emoji display, raised/lowered hands, mute-all, individual mute and remove. Test both mesh socket IDs and SFU user IDs.
9. Verify screen start/stop, own preview, presenter layout, restore camera, policy changes, browser cancel and audio-only room restrictions.
10. Verify polls with 2/10 options, single/multiple picks, re-vote, empty/invalid ballot, host close, late joiner state and simultaneous voters.
11. Verify Q&A named/anonymous display, payload exposure, upvote toggle, host answer, text limits and late join state.
12. Open notes on two clients; save, receive live update, make concurrent dirty edits and confirm 409 reconciliation. Test historical-attendee permission and team task creation.
13. Record locally in each transport, stop/leave and open the download. Test late joiner audio, screen recording composition, unsupported MediaRecorder, large sessions and mobile download behavior.
14. Verify attendance/report access, multi-tab/rejoin durations, live report caveats, final status, CSV quoting/formula escaping and persisted poll/Q&A/notes sections.
15. Verify reminders on an isolated clock/fixture: default/custom minutes, not-going exclusion, dedup claim and reschedule reset. Validate invitation email logs without interpreting queued as delivered.
16. Verify breakout APIs separately from the removed creation UI: counts, active-room conflict, assignment restrictions, invitation, stay/join, return and end.
17. Test mesh cap and host exemption, SFU selection, failed RTC fetch fallback, TURN allocation, Wi-Fi/mobile data, proxy websocket handling and multiple API instances.
18. Embed in a real partner page: login redirect with chatkonectPath, capability gating, token renewal, account switch, parent permissions, mobile resize, fullscreen and user-initiated capture.

## 19. Troubleshooting reference

| Symptom | Check | Likely next step |
|---|---|---|
| Meeting missing from list | Actual participant user ID and app scope | Inspect invitation added/unreachable output |
| Invitation email absent | invitesQueued and mail logs | Configure transport or resolve categorized send failure |
| Wrong reminder time | Store request payload | Current store omits selected reminderMinutes |
| Stuck waiting | Host socket presence and joinAnytime | Rejoin host; inspect join acknowledgment |
| Stuck asking to join | Host knock event and admitted pass | Verify listener names, meeting ID and pass expiry |
| Password accepted then room denied | passwordPass on socket/RTC | Forward the scoped password pass |
| SFU enabled but no token | requiresAdmission, lock and host presence | Complete socket admission, re-fetch RTC |
| Audio/video only works on same Wi-Fi | ICE list and relay allocation | Check temporary TURN config and reachability |
| Frozen mesh at larger size | Peer count, encoding and device uplink | Enable/test SFU for larger rooms |
| Camera/screen unavailable in iframe | HTTPS and parent Permissions-Policy | Delegate device/capture permissions; use gesture |
| Chat disappears on reload | In-room chat is transient | Persist separately if product requires history |
| Poll action appears ignored | Host/in-room checks and valid payload | Wait for full-array broadcast; inspect socket logs |
| Notes save returns 409 | updatedAt version | Preserve draft, reload and reconcile |
| Report duration looks odd | Live session, rejoin and multi-tab writes | Apply documented best-effort attendance semantics |
| Removed user returns | No durable room ban | Define and implement stronger moderation policy |
| Breakout create buttons absent | Current UI removal | Expected; API support is retained |

## 20. Source map and handoff ownership

| Source | Responsibility |
|---|---|
| server/routes/meetingRoutes.js | User meeting routes and meetings capability middleware |
| server/controllers/meetingController.js | HTTP behavior, invites, RTC tokens, notes, reports, breakouts |
| server/models/Meeting.js | Schema, limits, defaults, code generation |
| server/socket/index.js | Authentication, admission, signaling, collaboration, moderation, attendance |
| server/utils/meetingCapacity.js | Server mesh cap and exemptions |
| server/utils/livekit.js | SFU configuration and token grants |
| server/utils/meetingReminders.js | Reminder dispatch and atomic claims |
| server/utils/iceServers.js | TURN provider aggregation and readiness |
| server/utils/token.js | Access/admission/password token scopes and TTLs |
| client/src/pages/MeetingsPage.jsx | List, invite modal, attendance/report and CSV UI |
| client/src/pages/MeetingRoom.jsx | Device/room phases, transport selection and meeting controls |
| client/src/hooks/useMeetingRoom.js | Mesh media, interactions, reconnect and recording |
| client/src/hooks/useLiveKitRoom.js | SFU media and matching interaction contract |
| client/src/lib/meetingRecorder.js | SFU local recording helper |
| client/src/lib/meshQuality.js | Mesh encoder tuning and client warning thresholds |
| client/src/store/useMeetings.js | HTTP client/store and current reminder forwarding gap |
| client/src/components/modals/ModalHost.jsx | Scheduling form and entry policies |
| client/src/components/meeting/DeviceCheck.jsx | Prejoin preview, devices, audio tests and password |
| client/src/components/meeting/MeetingPollsPanel.jsx | Polls/Q&A UI |
| client/src/components/meeting/MeetingNotesPanel.jsx | Notes and team task flow |
| client/public/embed.js and client/src/EmbedApp.jsx | Partner frame/session/navigation integration |
| docs/DEVELOPER_INTEGRATION.md | Identity bridge and hosted UI examples |
| docs/SCALING_CALLS.md and docs/SELF_HOSTED_TURN.md | Existing media deployment guides |
| server/tests/meeting-*.mjs | Existing meeting integration and signaling suites |

For changes, keep route payloads, both media hooks, socket event contracts and UI permissions aligned. Update this guide when an implementation gap is resolved, a feature is removed, token/admission rules change or a new transport is added.

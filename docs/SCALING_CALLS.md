# Scaling calls and meetings to many participants

How many people can be in one call or meeting, why, and what to change to raise it.

---

## 1. The short answer

| Participants | Works well on | Notes |
|---|---|---|
| 2 – 6 | **Mesh** (default, no extra infrastructure) | Quality is scaled down automatically as the room grows |
| 7 – 9 | Mesh, degraded | The app warns in-room; video is dropped to ~240p |
| **10+** | **SFU required** (LiveKit) | Already implemented — set three env vars |

If you want rooms of 15–20 people, **you need the SFU**. No amount of tuning makes a mesh do it — the reason is arithmetic, not code quality.

---

## 2. Why a mesh stops at about six

In a mesh there is no server in the media path. Every participant sends their
camera to every other participant **separately**:

| Participants | Streams each device sends | Upload at 720p (~1.5 Mbps) |
|---|---|---|
| 3 | 2 | ~3 Mbps |
| 6 | 5 | ~7.5 Mbps |
| 10 | 9 | ~13 Mbps |
| **17** | **16** | **~24 Mbps** |

A typical home connection uploads 5–20 Mbps; a phone on mobile data far less. Past
about six people the uplink saturates, frames drop, and the device heats up
encoding that many streams at once. Everyone blames their own wifi.

The upside of a mesh is real, which is why it is the default: media is
peer-to-peer, so it costs no server bandwidth and nothing decrypts it in transit.
It is the right choice for the 1:1 and small-group calls that make up most usage.

---

## 3. What the app does automatically

**Adaptive encoding** (`client/src/lib/meshQuality.js`). Video was previously
captured at 720p and sent with *no sender limits*, so a six-person call tried to
push six full-rate streams. Each leg is now capped by room size:

| Remote peers | Resolution | Bitrate per stream |
|---|---|---|
| 1 | 720p | 1.2 Mbps |
| 2 – 3 | ~480p | 700 kbps |
| 4 – 6 | 360p | 350 kbps |
| 7+ | ~240p | 180 kbps |

Five peers now costs ~1.75 Mbps up instead of ~7.5 Mbps. Re-applied whenever
someone joins **or leaves**, so quality returns as a room shrinks.

**A capacity warning.** Past six participants the meeting room shows an amber
banner explaining that quality is reduced and that large rooms belong on the SFU.
Past nine it says plainly that video will stutter. Previously the room just
degraded silently.

---

## 4. Turning on the SFU (LiveKit)

The integration is **already built and tested** — server, client, and automatic
transport selection. It is off only because it needs credentials.

With an SFU each device sends **one** stream to the server, which forwards it to
everyone. Upload stays flat no matter how many people join, which is how 20-person
rooms are possible at all.

### Steps

1. Get a LiveKit server — [LiveKit Cloud](https://livekit.io/) has a free tier, or
   self-host (`livekit-server`).
2. Set three variables in `server/.env` (and in your host's dashboard):

   ```bash
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=APIxxxxxxxx
   LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxx
   ```

3. Restart the server. That is the whole change.

### What happens then

`GET /api/meetings/code/:code/rtc` starts returning a LiveKit URL and a
short-lived token instead of `null`, and the client renders `SfuRoom` rather than
`MeshRoom` — see `client/src/pages/MeetingRoom.jsx`. Chat, reactions, raised
hands, polls, Q&A and attendance keep running over the app's own socket room;
**only the media transport changes**.

Unset the variables and everything reverts to the mesh. Nothing else to undo.

---

## 5. What the SFU does NOT cover

**Group *calls* are mesh-only.** The SFU path is wired to meetings, not to the
`call:*` flow. For a large audio/video conference, use a **meeting** — that is the
surface built for it. A group call of 15 will warn and degrade.

If large group *calls* matter, the work is to route them through the same
`/rtc` transport selection that meetings already use, reusing `useLiveKitRoom`.

---

## 6. TURN is still required — for both

An SFU replaces the *fan-out*; it does not replace **TURN**. Without TURN, any
participant behind a strict NAT or on mobile data cannot form a media path at
all, and the symptom looks identical to a scaling problem: some people see each
other, some do not.

`VITE_TURN_*` is currently **empty**. Set it before testing with real
participants on real networks — see `client/.env.example`, or metered.ca's free
tier.

---

## 7. Verifying

```bash
cd server
node tests/meeting-mesh.mjs      # 28 checks — 3rd and 4th joiner mesh with everyone
node tests/group-call-mesh.mjs   # 20 checks — A adds C; B and C must see each other
```

Both assert that every participant is told about every other and that any pair can
signal directly. They cannot prove media renders — there is no real
`RTCPeerConnection` in a Node test — so a final check with several real devices on
different networks is still worth doing.

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

An SFU replaces the *fan-out*; it does not replace **TURN**. Without a relay, any
participant behind a strict NAT or on mobile data cannot form a media path at all —
the call rings, reports "connected", and carries no audio or video. This affects
every room size, so it matters more than the mesh ceiling.

### Configure it ONCE on the server

```
TURN_URL=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
TURN_SECRET=<coturn static-auth-secret>
```

That is the whole setup. `GET /api/v1/ice` then mints short-lived, signed
credentials for **every** surface — this app, the drop-in embed, and any partner
frontend. coturn must run in `use-auth-secret` mode; the secret never leaves the
server.

> This used to be two separate settings, and the second one failed silently.
> Server-side minting was reachable only at `/v1/embed/ice`, and the first-party
> client read nothing but the build-time `VITE_TURN_*` variables — so setting
> `TURN_URL` fixed embeds while leaving the app itself STUN-only. The client now
> fetches from the server, so one value covers everything.

### More than one relay

A relay adds a round trip, so one box serves one region well and everywhere else
poorly — and it is a single point of failure. Separate relays with `|` and give each
its own secret:

```
TURN_URL=turn:in.example.com:3478 | turn:eu.example.com:3478
TURN_SECRET=secret-for-india | secret-for-europe
```

The browser tries them in the order given, so list the nearest one first. Per-relay
secrets mean one compromised box does not hand out free bandwidth on the others. Full
detail: [SELF_HOSTED_TURN.md §9](SELF_HOSTED_TURN.md).

### Why not static credentials in the frontend

`VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` still work as an
explicit override, and take precedence when set. Avoid them in production: a
static credential shipped to a browser is readable in devtools and usable by
anyone to relay traffic on your bill. The minted ones carry their expiry inside
the signed username, so a leaked pair stops working on its own.

### Where to get a relay

| Option | Notes |
|---|---|
| **coturn**, self-hosted | One small VM. Full control, cheapest at volume. Set `static-auth-secret` and `use-auth-secret`. |
| **metered.ca** | Free tier; managed. |
| **Cloudflare / Twilio** | Managed, pay per GB. |

Relay bandwidth is the real cost, and in a mesh it scales with the square of the
room — every pair that cannot connect directly relays separately. An SFU reduces
that too, because each device holds one connection to the server.

`GET /api/v1/ice` requires authentication precisely because that bandwidth is
billable; it reports `relay: "stun_only"` with an explanatory note when nothing is
configured, so "why does my call have no audio" is answerable in one request.

---

## 7. Verifying

```bash
cd server
node tests/meeting-mesh.mjs      # 28 checks — 3rd and 4th joiner mesh with everyone
node tests/group-call-mesh.mjs   # 20 checks — A adds C; B and C must see each other
node tests/turn-relay.mjs        # 27 checks — credentials verify against coturn; relay network
```

The two mesh suites assert that every participant is told about every other and that
any pair can signal directly; `turn-relay` recomputes coturn's HMAC independently, so a
credential that passes there passes at a real relay. They cannot prove media renders — there is no real
`RTCPeerConnection` in a Node test — so a final check with several real devices on
different networks is still worth doing.

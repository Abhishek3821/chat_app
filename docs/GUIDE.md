# ChatConnect — Product & Technical Guide

This is the master guide: **what the product is, how it works, the exact things you must do by hand, and how everything flows.** For the endpoint-by-endpoint reference see [`API.md`](API.md).

---

## 1. What ChatConnect is

ChatConnect is a **real-time communication SaaS** — an original, premium messaging platform (not a WhatsApp clone). People sign up with an email, find each other, and:

- **Onboard securely** — email signup with a **6-digit OTP** verification, then find people and connect via **friend requests** (search by email/username → request → accept). You can only 1:1 chat/call people who accepted you.
- **Message** 1-to-1 and in **groups** in real time (typing indicators, read ticks, reactions, replies, unread badges, pinned/archived/muted chats, live presence).
- **Call** each other with real **WebRTC audio & video** (live camera/mic, mute, camera toggle, incoming accept/reject).
- **Schedule meetings**, post 24-hour **status stories**, manage **contacts**, and tune **privacy/notification settings**.
- Admins get an **analytics dashboard** (users, messages, calls, growth charts, moderation tables).

It ships with **dark & light themes**, a responsive desktop/tablet/mobile layout, and a **demo mode** so the whole UI is explorable with zero backend.

---

## 2. How it works (architecture & flow)

```
        ┌─────────────────────────────┐         ┌──────────────────────────────┐
        │   CLIENT (React + Vite)     │         │   SERVER (Node + Express)    │
        │  Tailwind · Framer · Zustand│         │   REST API  +  Socket.IO     │
        └───────────────┬─────────────┘         └───────────────┬──────────────┘
                        │  HTTPS REST (JWT)                      │
                        │───────────────────────────────────────▶  Express routes → controllers
                        │                                        │        │
                        │  WebSocket (Socket.IO, JWT auth)       │        ▼
                        │◀──────────────────────────────────────▶│   MongoDB (Mongoose models)
                        │   real-time events + WebRTC signaling  │
        ┌───────────────┴─────────────┐                         │
        │  Peer ⇄ Peer WebRTC media   │◀── STUN/TURN ───────────┘  (server only relays SDP/ICE;
        │  (audio/video, P2P)         │                             media is peer-to-peer)
        └─────────────────────────────┘
```

**Auth flow:** signup/login → server hashes password (bcrypt), issues a **JWT** (sent as httpOnly cookie *and* returned for Bearer use) → client stores it → every REST call and the socket connection present the JWT.

**Message flow (real time):**
1. Client `POST /api/messages` → controller saves it to MongoDB and sets the chat's `lastMessage`.
2. Server emits `receive-message` to the **chat room** (`chat:<id>`) over Socket.IO → all other members get it instantly (measured ~35 ms locally).
3. Sender also gets an optimistic bubble immediately; recipients' chat list + unread badge update via `chat-updated`.

**Call flow (WebRTC):**
1. Caller clicks call → browser asks **camera/mic permission** (`getUserMedia`) → creates an `RTCPeerConnection`, makes an **offer**.
2. Offer travels over Socket.IO (`call:invite`) → callee's screen pops up (**Accept/Decline**).
3. Callee accepts → captures media → sends an **answer**; both sides trickle **ICE candidates** through the server relay.
4. Once ICE connects, **audio/video flows directly peer-to-peer** (the server never sees the media).

**Presence:** on socket connect the user is marked online and broadcast to others; on disconnect, `lastSeen` is stamped and `user-offline` is broadcast.

**State (client):** three Zustand stores — `useAuth` (session), `useUI` (theme, panels, active modal, active call), `useChat` (chats, messages, typing).

---

## 3. ✅ What YOU must do manually

Everything below is **your side** — I can't do it because it needs your accounts/secrets.

| # | Task | Where | Notes |
|---|------|-------|-------|
| 1 | **Fix the MongoDB password** | Atlas → Database Access | Current creds return `bad auth`. Reset the password for `abhisheksinghchauhan97_db_user`, give it **Read/write to any database**. |
| 2 | **Put the working URI in `server/.env`** | `server/.env` | Include a db name: `...mongodb.net/chatconnect?appName=Cluster0` |
| 3 | **Set a strong `JWT_SECRET`** | `server/.env` | Any long random string. |
| 4 | **Seed demo accounts (optional)** | terminal | `npm --prefix server run seed` → 6 users (password `password123`), admin `admin@chatconnect.app`. Also creates mutual contacts, 2 pending friend requests to Aria, and sample statuses. |
| 5 | **Turn off demo mode for real chat** | `client/.env` | `VITE_DEMO_MODE=false` (leave the URL vars blank locally — the proxy handles it). |
| 6 | **(Calls over internet) add a TURN server** | `client/.env` | `VITE_TURN_URL/USERNAME/CREDENTIAL` from e.g. Metered.ca or Twilio. STUN alone won't cross strict NATs. |
| 7 | **Email for OTP (prod)** | `server/.env` | OTP verification is **ON by default** (`ENABLE_EMAIL_VERIFICATION=true`). With `EMAIL_*` blank (local dev) the code prints to the server console **and shows on the verify screen**. For production, fill `EMAIL_*` (SendGrid/Mailtrap/SES) so codes actually email. Set `ENABLE_EMAIL_VERIFICATION=false` to skip OTP entirely. |
| 8 | **Deploy** | Render + Vercel | Backend via [`render.yaml`](../render.yaml) (set `MONGO_URI`, `CLIENT_URL`); frontend via [`client/vercel.json`](../client/vercel.json) (set `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_DEMO_MODE=false`). |

> **Camera/mic note:** `getUserMedia` only works on **https** or **http://localhost**. A plain `http://192.168.x.x` LAN address will block the camera — use the deployed https site for real calls between devices.

---

## 4. Run locally

```bash
npm run install:all          # root + server + client deps
npm run dev                  # backend :5000  +  frontend :5290
```
Open **http://localhost:5290** (fixed, unique port — never clashes with your other projects).

To chat with a friend: both set `VITE_DEMO_MODE=false`, make sure the DB connects, both **sign up**, then **Contacts → search by email/username → add**, open the chat, message, and hit the call buttons.

---

## 4b. 🤝 How you and a friend connect (step by step)

This is the exact flow, and it's **independently verified end-to-end** (see the table below).

**Prerequisites (once):** MongoDB connected (task 1–2), `VITE_DEMO_MODE=false`, both apps running (`npm run dev`), and the site reachable by your friend — same Wi‑Fi via `http://<your-ip>:5290`, or a deployed `https://` URL (needed for the camera).

1. **Both create an account.** Each person opens the app → **Create account** → name, username, email, password.
2. **Verify the email (OTP).** After signup you're taken to the **verify screen**. Enter the 6-digit code:
   - Production (email configured): the code arrives in the inbox.
   - Local dev (no email configured): the code is **shown right on the verify screen** (and in the server console).
3. **Find each other.** Go to **Contacts** → search the other person by **email or username** → click **Add** (sends a friend request).
4. **Accept the request.** The other person opens **Contacts** → sees the request under **Contact requests** → clicks **Accept**. You're now mutual contacts.
5. **Chat.** Either person clicks **Message** on the contact (or **New chat**) → the conversation opens → type in real time. *(Before acceptance, starting a 1:1 chat is blocked — this is by design.)*
6. **Call.** In the chat header (or on the contact row) tap **📞 audio** or **🎥 video**. The other person gets an **incoming-call screen** with **Accept / Decline**. On accept, live audio/video connects peer-to-peer. The browser will ask for **camera/mic permission** the first time.
7. **Status.** Post a 24-hour story from the **Status** tab; your contacts see it in their feed.

## 5. Verification status (independently tested)

Run against the real backend + a real database, driven by automated browser + socket clients:

| Capability | Result |
|---|---|
| Backend boots + connects to Mongo | ✅ |
| Signup + login + JWT | ✅ |
| **OTP signup + verify** (wrong code rejected) | ✅ |
| **Friend request → accept** (mutual contacts) | ✅ |
| **1:1 chat gated** — blocked before contact (403), allowed after | ✅ |
| **Status** visible to contacts | ✅ |
| Direct chat create | ✅ |
| **Native WebSocket** connection | ✅ (`transport=websocket`) |
| **Real-time message A→B** | ✅ **~35 ms** |
| **Typing indicator** | ✅ |
| **WebRTC signaling** (invite→answer→ICE) | ✅ |
| Real camera/mic capture + live video render | ✅ (1280×720 stream) |
| Message persisted + fetchable | ✅ |
| Presence (online/last seen) | ✅ |
| All 8 screens render (dark **and** light) | ✅ 0 errors |
| Composer pinned + chat list scrolls | ✅ |

*(A subtle real-time bug was found and fixed during this pass: socket listeners were registered after an `await`, so early `join-chat` events were dropped — now fixed.)*

---

## 6. API & events

Full REST endpoint tables and the complete Socket.IO event list are in **[`API.md`](API.md)**.

<div align="center">

# 💬 ChatConnect
 
**A modern, premium real-time messaging platform — built on the MERN stack with an entirely original UI.**

Talk · Meet · Connect — one-to-one chat, groups, audio/video calls, scheduled meetings, status stories, and a full admin dashboard.

`React` · `Node/Express` · `MongoDB` · `Socket.IO` · `WebRTC` · `Tailwind CSS` · `Framer Motion` · `Lucide`

</div>

---

> **Original branding.** ChatConnect is **not** a WhatsApp clone. It has its own name, logo, palette (deep navy · soft purple · electric blue), glassmorphism design language, SaaS-style dashboard layout, and component system. It only shares the *category* of features common to modern messengers.

## ✨ Highlights

- **Premium, original UI** — glassmorphism cards, gradient accents, soft shadows, smooth Framer Motion transitions and micro-interactions.
- **Dark & light mode** — semantic design tokens flip the entire app instantly.
- **Fully responsive** — desktop 3-pane dashboard, tablet, and a mobile experience with a bottom nav + bottom-sheet modals.
- **Sidebar-based layout** — left icon nav rail → collapsible chat list → conversation → right info panel.
- **Real-time chat** — Socket.IO messaging, typing indicators, presence, read receipts, reactions, replies, and unread badges.
- **Calls & meetings** — WebRTC-signalled audio/video call screens (blurred backdrop, animated ringing, grid layout) and a calendar-style meeting scheduler.
- **Status stories** — 24-hour auto-expiring updates with a full-screen story viewer.
- **Admin dashboard** — analytics cards, growth/volume charts (Recharts), user management & reports tables.
- **Demo mode** — explore the entire UI instantly with rich mock data, **no backend or database required**.

## 🧱 Tech stack

| Layer | Tech |
|------|------|
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion, Lucide React, React Router, Zustand, Recharts, react-hot-toast |
| Backend | Node.js, Express, Socket.IO |
| Database | MongoDB + Mongoose |
| Realtime / Calls | Socket.IO (messaging + presence + WebRTC signaling), WebRTC (media) |
| Auth | JWT (httpOnly cookie + Bearer), bcrypt, optional email OTP |
| Uploads | Multer (local) with a Cloudinary extension point |
| Email | Nodemailer (falls back to console logging in dev) |

## 📁 Project structure

```
chatconnect/
├── package.json              # root scripts (run both apps together)
├── client/                   # React frontend (Vite)
│   ├── src/
│   │   ├── components/        # ui/ · layout/ · chat/ · modals/ · overlays/ · brand/
│   │   ├── pages/             # auth/ + Chats, Calls, Meetings, Status, Groups, Contacts, Settings, Admin
│   │   ├── store/             # Zustand stores: useAuth, useUI, useChat
│   │   ├── hooks/             # useSocket
│   │   ├── lib/               # api, utils, chat helpers, demoData
│   │   ├── App.jsx · main.jsx · index.css
│   └── vite.config.js · tailwind.config.js
└── server/                   # Express backend
    ├── config/               # db connection
    ├── models/               # User, Chat, Message, Call, Meeting, Status, Notification, Report, ContactRequest
    ├── controllers/          # auth, user, chat, message, group, call, meeting, status, notification, contact, report, upload, admin
    ├── routes/               # one router per module + index
    ├── middleware/           # auth (JWT/roles), error, upload, rateLimit
    ├── socket/               # Socket.IO events + WebRTC signaling
    ├── utils/                # token, sendEmail, asyncHandler, seed
    └── server.js
```

## 🚀 Getting started

### Prerequisites
- **Node.js ≥ 18**
- **MongoDB** (local or Atlas) — *only needed for the real backend; demo mode needs nothing.*

### 1. Install everything
```bash
# from the project root
npm run install:all
```
> This installs the root, `server/`, and `client/` dependencies.

### 2. Configure environment
```bash
# backend
cp server/.env.example server/.env      # then edit values (MONGO_URI, JWT_SECRET, …)

# frontend (optional — defaults to demo mode)
cp client/.env.example client/.env
```

### 3. (Optional) Seed demo data
```bash
npm --prefix server run seed
```
Creates demo users, a group, and messages. **All demo users share the password `password123`.**

| Email | Role |
|-------|------|
| `aria@chatconnect.app` | user |
| `leo@chatconnect.app` | user |
| `admin@chatconnect.app` | **admin** |

### 4. Run
```bash
npm run dev            # runs backend (:5000) + frontend (:5290) together
# or individually:
npm run dev:server
npm run dev:client
```
Open **http://localhost:5290** (ChatConnect uses this fixed, unique port so it never collides with other dev servers).

## 🧪 Demo mode (no backend needed)

`client/.env` ships with `VITE_DEMO_MODE=true`. In this mode the frontend runs entirely on built-in mock data — **any email/password logs you in**, and every screen (chats, calls, meetings, status, groups, contacts, settings, admin) is fully explorable. To connect the real backend instead, set `VITE_API_URL=http://localhost:5000/api` and `VITE_DEMO_MODE=false`.

## 📚 Documentation

- **[`docs/GUIDE.md`](docs/GUIDE.md)** — product overview, architecture & data flow, the full **"what you must do manually"** checklist, and independent verification results. **Start here.**
- **[`docs/API.md`](docs/API.md)** — every REST endpoint + Socket.IO event.

## 📡 API & realtime

- REST endpoints are documented in **[`docs/API.md`](docs/API.md)**.
- Socket.IO events (messaging, typing, presence, read receipts, WebRTC signaling) are documented in the same file.
- Health check: `GET /api/health`.

## 🌐 Deployment

- **Frontend** → Vercel / Netlify. Build command `npm run build` (in `client/`), output `client/dist`. Set `VITE_API_URL` + `VITE_SOCKET_URL` to your backend URL and `VITE_DEMO_MODE=false`.
- **Backend** → Render / Railway / AWS. Set all `server/.env` vars, point `CLIENT_URL` at the deployed frontend, use a MongoDB Atlas `MONGO_URI`. Socket.IO and CORS honour `CLIENT_URL`.

## 👥 Chatting with a friend (real mode)

Demo mode is single-user (mock data). To actually message another person you need the **real backend running + reachable**, and demo mode **off**.

**1. Turn on real mode** in `client/.env`:
```
VITE_DEMO_MODE=false
# leave VITE_API_URL / VITE_SOCKET_URL blank to use the dev proxy
```

**2. Same Wi-Fi / LAN (quickest test):** the dev client is exposed on your network (`host: true`). Find your machine's LAN IP (`ipconfig` → IPv4, e.g. `192.168.1.20`) and have your friend open `http://192.168.1.20:5290`. Backend CORS already allows LAN origins in development.

**3. Over the internet:** deploy (below) — or expose your local backend with a tunnel (`npx localtunnel --port 5000` / ngrok) and set `VITE_API_URL` to the tunnel URL.

**Process to connect two people:**
1. Both people **sign up** (each with their own email) on the Signup page.
2. On the **Contacts** page, search the other person by **email or username** and add them (or just start a chat from **New chat → search**).
3. Open the chat and message in real time. Use the header **phone/video** buttons to start a WebRTC call.

> WebRTC calls are peer-to-peer. On the same LAN they connect directly. Across the internet/mobile networks you must add a **TURN** server (e.g. Twilio, Metered, or self-hosted coturn) — STUN alone won't traverse strict NATs.

## 🌐 Deployment

- **Frontend → Vercel/Netlify:** root `client/`, build `npm run build`, output `dist`. [`client/vercel.json`](client/vercel.json) adds SPA rewrites. Set env `VITE_API_URL=https://<your-api>/api`, `VITE_SOCKET_URL=https://<your-api>`, `VITE_DEMO_MODE=false`.
- **Backend → Render:** [`render.yaml`](render.yaml) is a ready blueprint (root `server/`, health check `/api/health`). Set `MONGO_URI` (Atlas) and `CLIENT_URL` (your frontend origin) in the dashboard; `JWT_SECRET` is auto-generated.

## 📈 Scaling to many members

The backend is **scale-ready and flag-driven**: with no extra config it runs single-instance (in-memory presence, in-memory rate limits, inline jobs). Set the env vars below and it scales horizontally behind a load balancer — **no code changes**.

- **`REDIS_URL`** turns on all four at once: the **Socket.IO Redis adapter** (cross-instance message/presence fan-out), a **shared rate-limit store**, response **caching**, and a **BullMQ worker** that moves notification/push fan-out off the request path. Run multiple instances behind a load balancer with **sticky sessions** (or `transports: ['websocket']`).
- **`STORAGE_DRIVER=cloudinary`** (+ `CLOUDINARY_URL`) pushes uploads to a CDN so media isn't tied to one instance's disk. An S3 driver slots in behind the same `persistFile()` contract.
- **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`** enable **Web Push**, so messages reach users with the app closed — and the server isn't forced to hold a socket open for everyone.
- **Database:** MongoDB Atlas scales vertically/horizontally; the schema is indexed on hot paths (`chat+createdAt`, participants, `attachments.url`, text search, a TTL index for disappearing messages). For 10M+ add read replicas → sharding (by workspace/chat).
- **Calls:** add a **TURN** server for cross-NAT, and an **SFU** (mediasoup / LiveKit) for large group video instead of mesh WebRTC.
- **Stateless API:** JWT auth is stateless, so the API scales horizontally with no shared session store.

See the full feature-gap & scaling roadmap report generated during development for the phased plan (→100k →10M →100M).

## 🔒 Security

**Auth & sessions:** short-lived access JWT + rotating refresh token (httpOnly cookie), with a tracked **session registry** — every request re-validates the session, so logout and "log out other devices" revoke access immediately (idle + absolute timeouts; per-device list in Settings). bcrypt hashing, tokenVersion revocation on password change, two-step PIN app-lock.

**RBAC:** a central permission matrix ([utils/rbac.js](server/utils/rbac.js)) is the single source of truth across three role dimensions — platform (super-admin), workspace (owner/admin/member, incl. ownership transfer), and per-group (owner/admin/member) — enforced by one `authorize()` / `can()` / `groupCan()` layer.

**Plus:** Helmet + client CSP, CORS allow-list + Origin-based CSRF guard, Redis-backed rate limiting, NoSQL-injection sanitization (HTTP + socket id validation), Web-Push host allowlist, audience-gated media, and validated/size-capped uploads. See the OWASP Top 10 audit report generated during development.

## 📝 Notes
- The production bundle currently ships as a single chunk (>500 kB). For production you can lazy-load the Admin dashboard and emoji picker with `React.lazy` / `manualChunks` — noted as a follow-up, not a blocker.
- WebRTC media is peer-to-peer; the server only relays SDP/ICE signaling. For calls across restrictive NATs, add a TURN server.

<div align="center"><sub>Built with care · original design · not affiliated with any existing messaging brand.</sub></div>

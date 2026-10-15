# ChatKonect developer integration guide

Updated: 7 October 2026. This guide describes the integration shipped in this repository.

## 1. What you integrate

Embed the hosted ChatKonect UI in your platform and keep your own login. Your backend provisions a ChatKonect end user and mints their short-lived token. Your frontend loads `embed.js` and supplies that token. ChatKonect handles its own REST requests, sockets, uploads, call signaling and UI. No copying the frontend source or rebuilding chat screens is needed.

The iframe keeps ChatKonect's CSS, React and state separate from your platform. The loader works with HTML, React, Vue, Angular, Laravel, Django and other web platforms that can serve a page and an authenticated backend endpoint. Native mobile apps and restricted webviews require their own device-permission integration and testing.

End-user surfaces include direct chat, groups, contacts, attachments, voice notes, reactions, presence, receipts, audio/video calls, meeting scheduling and rooms, status, communities, broadcasts, starred messages and settings. Enable the required app capabilities first. Platform administration, API-secret management and first-party workspace/business consoles remain operator tools; they are not exposed to embedded end users.

Data flows: your session -> your `/chat-token` endpoint -> ChatKonect platform API -> a token for one user -> the embedded UI -> ChatKonect REST + Socket.IO. `appId` is public. `appSecret` stays on your backend. Users are isolated by app; users in different apps cannot discover or chat with each other. Use one app per required communication boundary, not one app per person.

## 2. Operator setup

Use Node 20 or later for the complete repository and the backend helper. Install with `npm run install:all`. Configure the API using `server/.env.example`, a working MongoDB connection and a strong JWT secret. Never share `server/.env` with an integrator.

Configure on the ChatKonect API host:

```env
NODE_ENV=production
CLIENT_URL=https://chat.example.com
EMBED_URL=https://chat.example.com
API_PUBLIC_URL=https://api.example.com
```

Configure on the ChatKonect frontend before building:

```env
VITE_API_URL=https://api.example.com/api
VITE_SOCKET_URL=https://api.example.com
VITE_DEMO_MODE=false
```

These are operator settings, not the third-party platform's settings. Build with `npm run build`; deploy `client/dist`. The API must support HTTP and WebSocket upgrades. Static hosting needs SPA fallback for `/embed` and `/embed/*`, and must serve `/embed.js` as JavaScript. A production reverse proxy may use same-origin `/api` and `/socket.io` instead of separate domains.

Sign into ChatKonect as the operator, open `/platform`, create an app, and save its App ID and one-time secret. Expand the app and enter the partner's development and production origins under **Allowed platform origins**, one per line, then save. Example: `http://localhost:4321` and `https://partner.example.com`. Never register a domain you do not control. Empty origins leave the embed parent origin unrestricted; pin actual origins for production.

For the complete messaging/calling experience, enable:

```text
chat, groups, calls, video, meetings, status, presence,
typing, receipts, reactions, attachments, voiceNotes, push
```

Calls and meetings need additional infrastructure described in section 6. Capability switches expose supported surfaces; browser-dependent notifications still require browser support and permission.

## 3. Add your backend identity bridge

Store only on the partner's server:

```env
CHATKONECT_API=https://api.example.com
CHATKONECT_APP_ID=app_REPLACE_WITH_YOUR_APP_ID
CHATKONECT_APP_SECRET=REPLACE_WITH_YOUR_SERVER_SECRET
```

Do not prefix the secret with `VITE_`, `NEXT_PUBLIC_` or another public environment-variable prefix. The token endpoint must authenticate your own signed-in user. Derive the user id from that session, never from a browser-supplied query or body.

The dependency-free Node helper is in `packages/node`. From the ChatKonect repository, run `npm pack ./packages/node`. Give the resulting `chatkonect-node-1.0.0.tgz` to the integrator; they install it in their backend with `npm install ./chatkonect-node-1.0.0.tgz`. The package is not assumed to be published on npm.

```js
import { createChatKonectClient } from '@chatkonect/node';
const ck = createChatKonectClient({
  apiUrl: process.env.CHATKONECT_API,
  appId: process.env.CHATKONECT_APP_ID,
  appSecret: process.env.CHATKONECT_APP_SECRET,
});

app.get('/chat-token', requireLogin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user?.id) {
    return res.status(401).json({ message: 'Sign in first.' });
  }
  try {
    const session = await ck.createUserSession({
      id: req.user.id,
      name: req.user.fullName || req.user.name,
      avatar: req.user.photoUrl || '',
    });
    res.json({ token: session.token,
      expiresInSeconds: session.expiresInSeconds });
  } catch {
    res.status(502).json({ message: 'Chat is unavailable.' });
  }
});
```

`requireLogin` and `req.user` belong to your platform: map these names to your authentication system. An implementation is also in `examples/saas-host/express-route.mjs`. Use a stable id; the helper converts numeric ids to strings. An external id is at most 128 characters. Provision all people who must appear in search; a person is otherwise created on their first token request. Users find each other by name or their generated ChatKonect username, not by the host platform's private email address.

For PHP, Python, Java or another backend, make two checked HTTPS POST requests in order. Both use `X-CC-App-Id: <APP_ID>`, `Authorization: Bearer <APP_SECRET>` and JSON:

| Request | JSON body | Purpose |
|---|---|---|
| `/api/v1/platform/users` | `{"externalId":"42","name":"Ada","avatar":""}` | Idempotent provision/profile update |
| `/api/v1/platform/tokens` | `{"externalId":"42"}` | Mint this user's session |

Stop on any non-success response, apply request timeouts, and return only `token` and `expiresInSeconds` to your browser. A personal `X-API-Key` is a different integration: it acts as its owner and is not a substitute for the app identity bridge.

## 4. Mount the complete UI

```html
<div id="chat" style="height:700px;width:100%"></div>
<script src="https://chat.example.com/embed.js"></script>
<script>
  const chat = ChatKonect.mount({
    el: '#chat',
    appId: 'app_REPLACE_WITH_YOUR_APP_ID',
    theme: 'system',
    getToken: async () => {
      const r = await fetch('/chat-token', {
        credentials: 'same-origin', cache: 'no-store'
      });
      if (!r.ok) throw new Error('Chat sign-in failed.');
      return r.json();
    },
    onReady: user => console.log('Chat ready', user.name),
    onError: error => console.error(error.code, error.message),
    onLogout: () => chat.destroy(),
  });
</script>
```

Replace the frontend origin and App ID. The container needs an explicit height. `getToken` may return the full `{ token, expiresInSeconds }` JSON or just the token string. It runs on mount and before the validated JWT expires. Avoid a permanently hardcoded token. The access token travels by origin-checked `postMessage`; it does not go in the iframe URL or persist over an ordinary ChatKonect login. Embedded API/socket requests do not require third-party cookies.

`chat.navigate('/calls')`, `chat.navigate('/meetings')` and `chat.navigate('/meet/ROOM_CODE')` drive the UI. Navigation before authentication is queued. `initialPath` opens a destination on mount. `chat.refreshToken()` asks the host for another token; its promise finishes when the token provider resolves, before server validation completes. `chat.destroy()` removes the iframe/listeners and releases its browser context. Call it on host logout or account change, then remount for the new signed-in user. The embedded Log out button ends the embedded session and calls `onLogout`; your platform decides whether its own login should end.

`onConfig` receives app capabilities and relay status. `onNavigate(path)` reports UI route changes. The optional `theme` is `light`, `dark` or `system`. Shared meeting/invite links point back to the host page with `?chatkonectPath=/meet/...` or an invite path. The loader opens that path after normal authentication. Your login flow must preserve the full return URL and this query parameter. Users still need membership/admission to join; the link grants no credentials.

Vue: mount in `onMounted` and destroy in `onBeforeUnmount`. Angular: mount in `ngAfterViewInit` and destroy in `ngOnDestroy`. For server-rendered HTML, load the script after the container exists. Use the same backend token bridge in every case.

## 5. React and Next.js

From this repository run `npm pack ./packages/react`. Install the resulting `chatkonect-react-1.0.0.tgz` in the consuming frontend. React 18+ is supplied by that app. The wrapper ships standard JavaScript and TypeScript definitions.

```jsx
'use client'; // required for this component in Next.js
import { useRef } from 'react';
import { ChatKonect } from '@chatkonect/react';

export function Messages({ currentUser }) {
  const chat = useRef(null);
  return <ChatKonect
    ref={chat}
    host="https://chat.example.com"
    appId="app_REPLACE_WITH_YOUR_APP_ID"
    identityKey={currentUser.id}
    theme="system"
    style={{ height: 700, width: '100%' }}
    getToken={async () => {
      const r = await fetch('/chat-token', { cache: 'no-store' });
      if (!r.ok) throw new Error('Chat sign-in failed.');
      return r.json();
    }}
    onError={error => console.error(error.message)}
  />;
}
```

Mount only for an authenticated user. `identityKey` must change on account changes so the old frame and cached UI state are discarded. A ref exposes `navigate`, `refreshToken`, and `destroy`. Inline callback changes do not remount the UI. Different ChatKonect frontend origins use their own loader registration. To show a page initially, pass `initialPath="/meetings"`.

## 6. Calls, meetings and hosting requirements

Serve the partner page and ChatKonect frontend over HTTPS. Localhost can be used for local development, but HTTP on a LAN address may not permit camera/microphone access. The browser must allow devices, and the host's Permissions-Policy must delegate camera/microphone to the ChatKonect frontend. The loader grants camera, microphone, display-capture, autoplay, clipboard-write, fullscreen and geolocation to its iframe; a stricter parent policy can still block them.

Example headers on the PARTNER PAGE (merge with your existing policy):

```text
Permissions-Policy: camera=(self "https://chat.example.com"),
  microphone=(self "https://chat.example.com"),
  display-capture=(self "https://chat.example.com")
Content-Security-Policy: script-src 'self' https://chat.example.com;
  frame-src https://chat.example.com
```

The header values above wrap for readability; send each header as one line. If your CSP uses nonces, apply your nonce to inline bootstrap code or put it in an allowed external script. Do not replace your complete CSP with this example. On the CHATKONECT embed response, do not send `X-Frame-Options: DENY` or `SAMEORIGIN`; allow the intended parent origins in `frame-ancestors`. The repository's Vercel rules exclude `/embed` and its subroutes from ordinary anti-framing headers. Check the deployed response because CDN or reverse-proxy headers can add restrictions.

For users on mobile data, office networks or different cities, operate a TURN relay. Configure `TURN_URL` and `TURN_SECRET` on ChatKonect's API; the browser retrieves temporary credentials. Do not put relay secrets in the partner frontend. Follow `docs/SELF_HOSTED_TURN.md` and `deploy/turn/README.md`. Verify allocation with `node deploy/turn/check-relay.mjs --env` before relying on cross-network media. Relay credentials being minted does not prove that a relay is reachable. Configure LiveKit with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` when larger meetings require an SFU; see `docs/SCALING_CALLS.md` for capacity limits.

Before a direct call, both users must be accepted contacts. A group call rings group members; use an accepted group membership. No amount of iframe configuration bypasses these authorization rules. Screen sharing requires a supported browser and a user gesture. Notifications/push in cross-origin frames are browser-dependent: use your host's own notification integration if notification permission is unavailable in an iframe. Chat and in-app call signaling remain separate from OS notification support.

## 7. Local example and acceptance checks

Start ChatKonect with `npm run dev`; the UI uses port 5290 and API port 5000. Ensure `VITE_DEMO_MODE=false`. Create the app, enable features and register `http://localhost:4321` in `/platform`.

PowerShell, from the repository root:

```powershell
$env:APP_ID='app_YOUR_APP_ID'
$env:APP_SECRET='YOUR_APP_SECRET'
node examples/saas-host/server.mjs
```

macOS/Linux:

```bash
APP_ID=app_YOUR_APP_ID APP_SECRET=YOUR_APP_SECRET \
  node examples/saas-host/server.mjs
```

Open `http://localhost:4321` and `http://localhost:4321/?as=bob` in another window. This example intentionally simulates Alice and Bob; it binds to loopback. Replace its fake user lookup with real session authentication before using its pattern in a product. Production integration starts from `express-route.mjs`, not the fake identity function.

Automated commands: `npm run test:sdk`, `npm run test:integration`, `npm run build`. The integration runner needs MongoDB access and uses named temporary test databases, cleaned after each suite; it refuses cleanup of the configured application database.

Before release, test two real host sessions. Verify user search and contact acceptance; direct and group messaging; attachments/voice notes; audio and video in both directions; meeting create/join, lobby/admission, chat, screen sharing and leave; shared host-page links; renewal after a short token lifetime; host logout/account switching; denied device permissions; mobile resizing; and a call between Wi-Fi and mobile data with TURN available. Verify that users of another app remain inaccessible.

## 8. Troubleshooting and ownership

| Symptom | Check |
|---|---|
| Blank or blocked frame | Container height, SPA fallback, frame-ancestors and X-Frame-Options |
| `config_failed` | App ID, app active, parent origin allowed, API URL, demo mode off |
| `loader_failed` | React host origin, script CSP, `/embed.js` response |
| `get_token_failed` / `get_token_threw` | Your login session and `/chat-token` HTTP response |
| `no_token` | Return a token string or JSON with a nonempty `token` |
| `token_rejected` | Correct app, active user, token expiry, valid backend JWT/session |
| Calls ring but no media | Device permissions, HTTPS, TURN allocation and firewall |
| Direct call refused | Both users must be accepted contacts |
| Meetings return to chat | Redeploy the updated frontend with `/meet/:code` in the embed |
| Session fails later | Keep `getToken` working; it must mint fresh tokens for your current session |
| Shared link loses destination | Preserve `chatkonectPath` through host login redirects |
| Push unavailable | Browser support; use a host notification flow where needed |

The ChatKonect operator owns API/UI deployment, MongoDB, WebSocket proxying, storage, TURN/SFU, origins, capabilities and app-secret rotation. The partner developer owns the signed-in user mapping, protected token endpoint, container lifecycle, CSP/device delegation and return-URL handling. Rotate lost secrets in `/platform`, then update the partner backend. Never log app secrets or user tokens.

To remove an integration permanently, use the app row's trash icon or **Delete app** in `/platform`, then type its public app ID. This deletes the app and all its users, including suspended users, revokes their sessions, disconnects active sockets and cleans their related database records. Other apps remain intact. **Disable app** preserves users and data for later re-enabling. An app with **deletion pending** can only complete deletion; select **Retry deletion**. Operator API details and storage retention limits are in `docs/PLATFORM.md`.

Verification in this task covers the production build, loader/helper behavior, app-scoped authentication, host provisioning, tenant isolation, REST chat/meeting capabilities and Socket.IO call/meeting signaling. The supplied guide is not a claim that every browser/network has been media-tested; browser/device and cross-network acceptance checks above remain deployment checks.

Primary deployment references: [MDN Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), and [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json). API details: `docs/PLATFORM.md`, `docs/API.md`, `docs/SOCKET_EVENTS.md`, `docs/MEETINGS.md`.

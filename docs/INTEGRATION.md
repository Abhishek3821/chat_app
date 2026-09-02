# Putting ChatKonect chat inside another project

One page, one recommended path. Depth lives in [PLATFORM.md](PLATFORM.md); this is
the decision and the steps.

---

## 1. Pick a mode

| | **A — Drop-in embed** | **B — Your own UI** |
|---|---|---|
| You write | one backend endpoint + 6 lines of HTML | every screen |
| Chat UI | ours (chats, groups, attachments, reactions, receipts, presence, typing, search) | yours |
| Styling | isolated in an iframe; cannot collide with your CSS | matches your app natively |
| Time to working chat | minutes | a real frontend project |
| Surface to get wrong | almost none | REST + ~90 socket events |

**Use A unless you specifically need chat rendered inside your own layout.** Every
integration failure recorded on this project was a wrong field name or route on
path B — `receiverId` vs `to`, `call:end` vs `call:ended`, `join-chat` given an
object instead of a string, `participants` vs `members`. Path A removes that entire
category because you never touch those contracts.

There is no middle option: no package renders individual pieces (a message list, a
composer) inside your layout. That would mean shipping our React tree into your
bundle, where it fights your React version, your Tailwind preflight and your global
CSS in every host it lands in.

---

## 2. Mode A — the whole integration

### Once, as operator

In the admin console → **/platform** → **New app**. Copy the secret (shown once).

For chat only, grant: `chat`, `groups`, `presence`, `typing`, `receipts`,
`reactions`, `attachments`. Leave `calls`, `video`, `meetings`, `status` off — the
embed hides what you don't grant, so the UI comes out chat-only with no dead
buttons. Chat needs no TURN and no SFU; those are only for calls and meetings.

Set on the API host:

```
EMBED_URL=https://<your-chatkonect-frontend>
CLIENT_URL=https://<your-chatkonect-frontend>
NODE_ENV=production
```

Then register your project's origin on the app (no console field for this yet):

```bash
curl -X PATCH https://<api>/api/apps/<app-_id> \
  -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
  -d '{"allowedOrigins":["https://your-project.com","http://localhost:3000"]}'
```

### In your project's backend — one endpoint

```js
const ck = {
  'X-CC-App-Id': process.env.CHATKONECT_APP_ID,
  Authorization: `Bearer ${process.env.CHATKONECT_APP_SECRET}`,
  'Content-Type': 'application/json',
};

// requireLogin is YOUR auth. Without it, this impersonates anyone.
app.get('/chat-token', requireLogin, async (req, res) => {
  const me = req.user;

  // Idempotent — safe on every call, keeps name/avatar in sync.
  await fetch(`${CK_API}/api/v1/platform/users`, {
    method: 'POST', headers: ck,
    body: JSON.stringify({ externalId: me.id, name: me.fullName, avatar: me.photoUrl }),
  });

  const r = await fetch(`${CK_API}/api/v1/platform/tokens`, {
    method: 'POST', headers: ck, body: JSON.stringify({ externalId: me.id }),
  });
  if (!r.ok) return res.status(502).json({ error: 'chat unavailable' });

  const { token, expiresInSeconds } = await r.json();
  res.json({ token, expiresInSeconds });   // never the secret
});
```

`externalId` is **your** user id. That one mapping is the whole identity bridge:
your login stays your login. Any id shape works — UUID, email, numeric.

### In your project's frontend — one block

```html
<div id="chat" style="height: 600px"></div>
<script src="https://<your-chatkonect-frontend>/embed.js"></script>
<script>
  const chat = ChatKonect.mount({
    el: '#chat',
    appId: 'app_xxxxxxxxxxxx',
    getToken: () => fetch('/chat-token').then(r => r.json()).then(d => d.token),
    onReady: (user) => console.log('chat ready', user.name),
    onError: (err) => console.error(err.code, err.message),
  });
</script>
```

React: use `packages/react/` — `<ChatKonect host=… appId=… getToken={…} />`.

**The container needs a real height.** The embed fills its box; a `<div>` with no
height collapses to zero and looks like nothing rendered. This is the most common
mistake by a wide margin.

### Try it first

```bash
APP_ID=app_xxx APP_SECRET=cc_sk_xxx node examples/saas-host/server.mjs
```

`http://localhost:4321`, plus `?as=bob` in a second window — two users chatting
inside a fake host app. [examples/saas-host/](../examples/saas-host/) is the code
above in ~100 lines per file; copy from there, not from this page.

---

## 3. What makes it uninterrupted

Not claims — each is enforced somewhere and covered by a suite.

| Risk | How it is handled |
|---|---|
| **Token expires mid-conversation** | The embed asks the host at 80% of lifetime (`token-expiring`); the loader calls `getToken` again and pushes a fresh one. The UI is not torn down — `init()` re-validates in place. |
| **Browser blocks iframe storage** (Safari, third-party storage off) | The token is held in **memory** and only mirrored to `localStorage`. Storage is an optimisation for surviving a reload, never a requirement. `test-token-store.mjs` (20 checks). |
| **Socket drops / network flaps** | Socket.IO reconnects; `useSocket` refreshes the access token once on `connect_error` (guarded against a retry storm) and re-emits `join-chat` for the active chat, then resyncs. |
| **Your project's CSS or React version** | Complete isolation — the embed is a separate document. |
| **A message arriving while the tab is backgrounded** | Delivered on reconnect via resync; unread counts mirror into the tab title. |
| **Wrong payload silently dropped** | Not applicable on this path — you send no socket payloads. |

Verified by `embed-dropin.mjs` (35), `embed-host-example.mjs` (28),
`test-embed-loader.mjs` (37), `test-token-store.mjs` (20),
`audit-embed-protocol.mjs`, plus `chat-realtime.mjs` (39) and
`realtime-browser.mjs` (17) for the chat behaviour itself. All in CI.

---

## 4. Security rules

1. **The app secret is backend-only.** Never in frontend code, a mobile binary, a
   public env var, or a commit. Anyone holding it can mint a token for *any* user
   in your tenant.
2. **Mint behind your own auth.** Your `/chat-token` must verify your session
   first, or it is an open door to impersonate any `externalId`.
3. **Register your origins.** Empty means "any origin" — fine locally, pin it
   before production.
4. **The token never travels in a URL.** The loader passes it by `postMessage` to
   one verified origin. Don't work around this.

---

## 5. When the frame won't start

`onError` gives a code. Read it before anything else.

| Code | Cause |
|---|---|
| `config_failed` + 403 | Your origin isn't in the app's `allowedOrigins` |
| `config_failed` + 404 | Wrong `appId` |
| `token_rejected` | The token minted but was refused — expired, or the app is disabled |
| `not_embedded` | `/embed` was opened directly instead of through `embed.js` |
| `get_token_failed` | Your `/chat-token` endpoint errored — check its response shape |
| *blank frame, no error at all* | The frontend host is sending `X-Frame-Options: DENY` for `/embed`. See [PLATFORM.md §10](PLATFORM.md). |

Confirm which build a host is running:

```bash
curl https://<api>/api/health     # reports `commit`
```

---

## 6. Mode B, if you must

Full REST + Socket.IO: [API.md](API.md), [SOCKET_EVENTS.md](SOCKET_EVENTS.md). Read
the **silent-failure warning at the top of SOCKET_EVENTS.md §2 first** — every
handler drops a malformed payload with no error, no ack and no log, which is
indistinguishable from a dead relay. The four contracts that actually catch people
are listed there.

---

## See also

- [PLATFORM.md](PLATFORM.md) — tenants, tokens, capabilities, the embed in depth
- [SCALING_CALLS.md](SCALING_CALLS.md) — TURN and the SFU (only needed for calls)
- [API.md](API.md) · [SOCKET_EVENTS.md](SOCKET_EVENTS.md) — the full surface

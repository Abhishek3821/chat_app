# Embedding ChatKonect in your own SaaS

A runnable stand-in for your product. Two files, Node built-ins only, no install.

## Run it

1. In the ChatKonect admin console → **/platform** → **New app**. Copy the App ID
   and the secret (shown once).
2. Add `http://localhost:4321` to that app's **allowed origins** (or leave the list
   empty, which means "any origin").
3. Start the ChatKonect API and frontend as usual (`:5000` and `:5290`).
4. Then:

```bash
APP_ID=app_xxx APP_SECRET=cc_sk_xxx node examples/saas-host/server.mjs
```

Open <http://localhost:4321> — and <http://localhost:4321/?as=bob> in a second
window to have two users who can message and call each other.

## What to copy into your real product

**One backend endpoint.** `GET /chat-token` in `server.mjs`. Replace `currentUser()`
with your real session lookup, then keep the two calls exactly as they are:
provision (idempotent, safe every time) then mint. The app secret stays server-side.

**One block of frontend.** The `<script>` at the bottom of `index.html`:

```js
ChatKonect.mount({
  el: '#chat',
  appId: 'app_xxx',
  getToken: () => fetch('/chat-token').then((r) => r.json()).then((d) => d.token),
});
```

`getToken` is called on mount **and again before the token expires**, so the session
never visibly drops. That is the whole integration.

## The layout rule that catches people

The container needs a **real height**. The embed fills its box; a `<div>` with no
height collapses to zero and looks like nothing rendered.

## If the frame stays on "Connecting…"

Open the console. `onError` reports a code:

| Code | Cause |
|---|---|
| `config_failed` with a 403 | The host origin is not in the app's allowed origins |
| `config_failed` with a 404 | Wrong `appId` |
| `token_rejected` | The token minted but was refused — check it is not expired and the app is active |
| `not_embedded` | `/embed` was opened directly instead of through the loader |
| nothing at all, blank frame | The frontend host is sending `X-Frame-Options: DENY` for `/embed` — see PLATFORM.md §10 |

## Not covered here

Calls between users on different networks need a TURN relay. That is an operator
setting (`TURN_URL` + `TURN_SECRET`), not yours — the embed fetches credentials
itself from `/api/v1/embed/ice`. Without it, `onConfig` reports
`relay: "stun_only"` and this example logs a warning.

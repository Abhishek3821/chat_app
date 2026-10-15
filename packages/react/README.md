# @chatkonect/react

A thin wrapper over the `embed.js` loader — the iframe does the real work, so this
package stays deliberately small. It exists so a React host does not have to
manage script injection and cleanup by hand; there is no second implementation to
drift out of sync.

```jsx
import { ChatKonect } from '@chatkonect/react';

<ChatKonect
  host="https://chat.example.com"
  appId="app_7f3c9a2b4d1e"
  getToken={() => fetch('/my-app/chat-token').then((r) => r.json()).then((d) => d.token)}
  onReady={(user) => console.log('ready', user)}
  style={{ height: 600 }}
/>
```

`getToken` is called on mount **and again before the token expires**, so sessions
never visibly drop. It must call your own backend — the app secret must never
reach the browser.

Install from a tarball made with `npm pack ./packages/react`. This repository
does not assume the package has been published to npm. React 18+ is a peer
dependency supplied by the consuming app. The package contains standard JS and
TypeScript declarations, and can be imported without transpiling dependency JSX.

Additional props: `theme`, `initialPath`, `identityKey`, `onLogout`, `onNavigate`.
Pass your signed-in user's id as `identityKey` so switching accounts remounts the
frame and clears its state. `getToken` can resolve to a JWT string or `{ token }`.
Check the HTTP status before returning token JSON. Use a container with a real
height (for example `style={{ height: 700 }}`).

A React ref exposes `navigate(path)`, `refreshToken()` and `destroy()`.
For Next.js, place this component in a client component (`'use client'`).
The host application's CSP must allow the ChatKonect script and frame origin.
Its Permissions-Policy must allow the ChatKonect origin to use camera/microphone.

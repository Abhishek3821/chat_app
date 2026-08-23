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

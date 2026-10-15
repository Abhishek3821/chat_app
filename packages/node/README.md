# @chatkonect/node

Server-only, dependency-free identity bridge. Node 20 or later.

```js
import { createChatKonectClient } from '@chatkonect/node';

const chat = createChatKonectClient({
  apiUrl: process.env.CHATKONECT_API,
  appId: process.env.CHATKONECT_APP_ID,
  appSecret: process.env.CHATKONECT_APP_SECRET,
});

// Call behind your authenticated session, using the signed-in user's profile.
const session = await chat.createUserSession({ id: user.id, name: user.name });
// Return only session.token and session.expiresInSeconds to your frontend.
```

The helper provisions the user idempotently, checks HTTP errors, applies request
timeouts, then mints a token. It accepts a backend origin or a URL ending in
`/api`. Convert your session profile to `{ id, name, avatar?, bio? }`.

Distribute as a tarball with `npm pack ./packages/node` from this repository.
Install that file in the consuming backend. The package is not assumed to be
published to npm. See [the developer guide](../../docs/DEVELOPER_INTEGRATION.md)
and [the authenticated Express example](../../examples/saas-host/express-route.mjs).

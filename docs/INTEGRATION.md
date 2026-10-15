# Integrate ChatKonect in another platform

Use the hosted UI with your hosted backend, authenticated by the other platform's
own login. The current instructions, sample code, deployment requirements and
acceptance checklist are in [DEVELOPER_INTEGRATION.md](DEVELOPER_INTEGRATION.md).

Give another developer the [Word integration guide](ChatKonect_Developer_Integration_Guide.docx).

The integration has three parts:

1. Create an app in `/platform`, register the partner origins and enable the required capabilities.
2. Add an authenticated token endpoint in the partner backend. Keep the app secret there; provision the signed-in user and mint their short-lived token.
3. Load `/embed.js` from ChatKonect's frontend, or use `packages/react`, and mount the UI in a container with an explicit height.

Use [packages/node](../packages/node/) for the backend identity bridge and
[examples/saas-host/express-route.mjs](../examples/saas-host/express-route.mjs) for
the Express route. The [local host example](../examples/saas-host/README.md) runs
with two simulated users so you can try the UI first.

The embedded UI includes chat, groups, audio/video calls, meeting scheduling and
rooms, contacts, status, communities, broadcasts, starred messages and settings.
Operator administration and first-party workspace/business consoles remain
outside the embedded end-user surface. Browser device permissions, a reachable
TURN relay and your deployment headers must be configured for cross-network calls.

To build your own UI instead, use [PLATFORM.md](PLATFORM.md), [API.md](API.md) and
[SOCKET_EVENTS.md](SOCKET_EVENTS.md). That path requires implementing the REST,
Socket.IO and WebRTC contracts yourself.

# Platform guide

Prepared: 15 October 2026 | ChatKonect | App developer handoff

## 1. Product and integration model

ChatKonect provides hosted chat, groups, contacts, attachments, voice notes, audio/video calling, meetings and status. The existing implementation uses a React frontend, Node/Express API, MongoDB, Socket.IO signaling and WebRTC media. The partner keeps its own login and connects identities through a backend token bridge.

One App represents one tenant and communication boundary. Provision people who need to communicate under the same App. The public App ID identifies the tenant; the App secret authorizes the partner backend to provision users and mint sessions. Browser and mobile client bundles must never contain the App secret.

The supported drop-in UI is a hosted web iframe loaded by embed.js, with a React wrapper available. A native Android/iOS app can use the identity/API approach, but must implement or validate its own UI/WebView lifecycle, device permissions and notification behavior. A packaged native SDK is not promised by this handoff.

## 2. Handoff values to supply

| Value | Example placeholder | Owner |
|---|---|---|
| ChatKonect UI origin | https://chat.example.com | Operator |
| API origin | https://api.example.com | Operator |
| Public App ID | app_REPLACE_ME | Operator |
| App secret | Deliver separately to backend owner | Operator |
| Allowed parent origins | https://partner.example.com | Both teams |
| Partner token endpoint | /chat-token | App developer |

All addresses and credentials in these guides are placeholders. The operator must provide the actual deployed origins and App ID. Do not forward server/.env. Deliver the App secret using a secure credential-sharing channel.

## 3. Operator setup

Open /platform in the ChatKonect UI, create an App and save its one-time secret. Register the partner's exact development and production origins under Allowed platform origins. An empty list allows unrestricted embed parent origins; set actual origins before release. Origin checks support browser integration and do not replace authentication.

For the full experience, configure these capabilities:

```text
chat, groups, calls, video, meetings, status, presence,
typing, receipts, reactions, attachments, voiceNotes, push
```

New Apps default to chat, groups, presence, typing, receipts, reactions and attachments. Groups, calls, meetings and status have server-side REST router capability gates. The remaining flags must not be treated as a complete entitlement or billing enforcement system; video is not gated independently from calls.

The default seat limit is 10,000 and default user-token lifetime is 60 minutes. Operator updates clamp the seat limit to 1-1,000,000 and token lifetime to 5-1,440 minutes. Existing users can be updated idempotently; creating another account at the seat limit returns 429.

## 4. Backend identity flow

1. Authenticate the person using the partner's own session.
2. Read the stable person ID and profile from that trusted session.
3. POST /api/v1/platform/users to provision or update that person.
4. POST /api/v1/platform/tokens for the same externalId.
5. Return only token and expiresInSeconds to the signed-in client.
6. Supply the user token to the embed or use it for protected REST and Socket.IO.

Every platform request uses these server-only headers:

```text
X-CC-App-Id: app_REPLACE_ME
Authorization: Bearer REPLACE_WITH_APP_SECRET
Content-Type: application/json
```

externalId is a string of at most 128 characters. Use a stable internal identifier; do not trust a client-supplied user ID. User provisioning requires name. avatar and bio are optional. Repeated provisioning updates the existing profile rather than creating another account.

The token response contains success, token, expiresInSeconds, user and features. It creates a tracked user session; the browser is not supplied a refresh token. Renewal must re-mint through the partner's authenticated token endpoint. The drop-in loader requests renewal before the validated JWT expires.

## 5. Platform API reference

Base: https://api.example.com/api/v1/platform. All five endpoints require the App ID and App secret.

| Method and path | Input | Result |
|---|---|---|
| GET /whoami | No body | App identity, features, limits, active |
| POST /users | externalId, name, avatar?, bio? | 201 new / 200 existing user |
| GET /users | limit optional; default 50, cap 200 | count and users, newest first |
| POST /tokens | externalId | User token, expiry, user, features |
| DELETE /users/:externalId | URL-encoded externalId | Suspends user; retains history |

GET /users returns a limited list; this route does not expose a documented cursor for traversing every account. The returned count is the result count.

Suspension increments tokenVersion, so existing user tokens fail subsequent authorization. Re-provisioning does not reactivate a suspended user. There is no platform API reactivation endpoint; coordinate reactivation with the operator.

| HTTP status | Typical cause | Developer action |
|---|---|---|
| 400 | Invalid/missing identity or profile field | Correct request validation |
| 401 | Missing/wrong App ID or secret | Check server configuration |
| 403 | App disabled, user suspended or capability denied | Contact operator/check state |
| 404 | Token requested before provisioning | Provision the user first |
| 429 | Provisioned-user seat limit | Ask operator to review capacity |

## 6. Operator management API

These endpoints use a signed-in ChatKonect user session rather than the App secret. Controllers scope access to the App owner; platform admins can manage all Apps. The public /platform screen is an operator surface. The management route parameter :id is the App database ID, not its public appId.

| Method and path | Behavior |
|---|---|
| GET /api/apps | List visible Apps |
| POST /api/apps | Create App; reveal secret once |
| PATCH /api/apps/:id | Update name, active, features, allowedOrigins, limits |
| GET /api/apps/:id/stats | Users, active users, token counters and limits |
| POST /api/apps/:id/rotate | Replace App secret immediately |
| DELETE /api/apps/:id | Disable and preserve users/data |
| DELETE /api/apps/:id/permanent | Permanently delete App and related accounts |

Rotation invalidates the previous App secret immediately; update the partner backend in coordination. Do not assume previously minted user sessions are revoked by secret rotation alone.

Disabling stops platform requests and new embed config/session validation. It does not universally revoke every previously issued user token on all ordinary API paths; do not use it as a guaranteed immediate session kill switch.

Permanent deletion requires JSON {"confirmAppId":"app_REPLACE_ME"}. It removes tenant accounts and related database records, revokes sessions and disconnects active sockets. Other Apps remain. Failed cleanup leaves the App disabled with deletion pending; use Retry deletion. Uploaded objects and backups remain subject to storage retention policy.

## 7. Communication rules and hosting

Direct chat/calls require accepted contacts. Group calling uses authorized group membership. Provisioning users does not automatically make them contacts. Tenant isolation is the intended boundary: verify that users of another App cannot be discovered or contacted during acceptance testing.

Both partner and ChatKonect frontend need HTTPS for production device access. The API must accept WebSocket upgrades. Static hosting must serve embed.js and route /embed and /embed/* to the frontend. The partner must allow the UI in CSP and delegate camera/microphone permissions. The ChatKonect embed response must permit the intended framing origins.

Cross-network media needs a reachable TURN relay. The operator configures TURN_URL and TURN_SECRET on the API, then verifies a real allocation using deploy/turn/check-relay.mjs --env. Larger meetings can use configured LiveKit/SFU infrastructure. Push and screen capture depend on browser/device support and permissions; include physical-device tests for native WebViews.

## 8. Responsibilities and release checklist

Operator: deploy UI/API, maintain MongoDB and storage, configure WebSocket proxy, origins, capabilities, TURN/SFU, and rotate credentials.

App developer: protect /chat-token, map trusted identity, mount/unmount the UI, renew tokens, handle account switching and logout, preserve shared-link return URLs, and configure host CSP/device delegation.

1. Supply real deployment values and a secret through a separate secure channel.
2. Test two signed-in partner users, search and accepted contacts.
3. Test direct/group messages, attachments, calls and meeting admission.
4. Test token renewal, logout and switching between accounts.
5. Test denied device permissions, screen sharing and mobile layout.
6. Test Wi-Fi-to-mobile-data media with verified TURN.
7. Test that another tenant's users and chats remain inaccessible.

Read the companion App Developer Integration Guide for backend and frontend code. Source references: server/routes/platformRoutes.js, server/routes/appRoutes.js, server/controllers/platformController.js, server/controllers/embedController.js, server/models/App.js, server/utils/appAuth.js, server/middleware/auth.js and docs/PLATFORM.md. This handoff documents local source behavior; it does not certify a production deployment or device compatibility.

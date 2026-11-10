# Full module audit — 19 October 2026

## Fix update — 20 October 2026

F1–F5 have now been fixed locally. Customer inbox responses omit internal notes;
broadcast delivery rechecks both users' blocks and contacts; video-note sends and
scheduling verify actual local file bytes or signed cloud upload metadata;
first-party ICE uses the shared provider resolver and preserves legacy response
fields; chat removal checks membership before any write. Existing cloud clips
without proofs are checked through the configured Cloudinary account when reused.

The original findings and counts below describe the pre-fix audit. Current
verification and remaining device/provider limits are recorded in
[the fix report](Audit_Fixes_2026-10-20.md).

## Result

The existing server suites pass, but additional boundary checks reproduced **four important issue areas and one lower-severity API inconsistency**. This audit did not change application source, configuration or production records. Earlier local changes remain in place.

All runtime fixtures used a separate local MongoDB process and synthetic accounts. Outbound provider requests were blocked. The push-provider response was simulated, and email credentials were disabled. No real user received an audit message. The browser backend returned no available browsers, so UI click-through, physical devices, real media and production hosting are not signed off.

## Confirmed findings

### F1 — High: internal team notes leak in a customer response

Module: workspace customer inbox. Source: server/controllers/workspaceToolsController.js, startInboxThread, around line 38.

The customer-facing GET thread endpoint removes notes. However, posting a follow-up through POST /api/workspaces/:workspaceId/inbox returns the complete existing thread, including its internal notes.

Reproduced with separate team-owner and customer accounts: create a thread, add an internal note as the owner, then post another customer message. The customer response is HTTP 201 with a nonempty thread.notes array. This is an API disclosure; no claim is made that the normal customer screen displays the notes.

Priority: fix first. Apply the same customer-safe response serialization on every customer-facing creation/follow-up path, including the duplicate-create retry path. Keep owner/staff note access working.

### F2 — High: broadcasts bypass user blocking

Module: broadcast messaging. Source: server/controllers/broadcastController.js, keepMutualContacts and sendBroadcast, around lines 13 and 77.

The recipient blocked the sender. A control request through POST /api/messages correctly returned 403, but POST /api/broadcasts/:id/send returned HTTP 200 with sent: 1 for the same blocked recipient.

The broadcast filter verifies mutual contacts but does not check either person's blockedUsers. The sender also bypasses the shared message-delivery validation by creating Message records directly.

Priority: enforce blocking consistently at broadcast delivery time. Preserve the existing skip/count behavior and legitimate recipient delivery.

### F3 — Medium: video-note size policy can be bypassed through another API path

Module: uploads and video-note messages. Sources: server/middleware/upload.js, receiveUploads; server/controllers/messageController.js, validateOutgoing, around line 223.

The declared video-note upload path correctly enforces 10 MB, and the recorder stops at 60 seconds. However, the final message validator trusts attachment size/duration supplied by the client.

Reproduced sequence:

1. Upload an 11 MB fixture through the ordinary 50 MB upload path.
2. Submit its returned URL as type: videoNote while replacing attachment.size with 1.
3. POST /api/messages returns HTTP 201 although the uploaded object is 11,534,336 bytes.

The earlier upload checks covered the declared video-note upload path; this audit added cross-route relabelling. Normal UI limits work, but this is not complete enforcement against crafted API requests.

Priority: validate against authoritative upload metadata, rather than trusting the submitted size. Preserve forwarding and cloud/local storage compatibility. Actual duration cannot be independently verified from client metadata; the server currently does not decode recordings to measure it.

### F4 — Medium: first-party TURN handling disagrees with configured providers

Module: first-party calls. Sources: server/controllers/rtpccred.js, getTurnCredentials, around line 4; client/src/lib/iceServers.js.

Two controlled checks failed:

- With TURN_SECRET absent, the first-party credential handler throws instead of returning a controlled configuration response.
- With a valid audit-only secret and a different TURN_URL, it still returns the hardcoded relay host rather than that configured URL.

The shared /api/v1/ice provider suite passes 79/79, but the first-party client requests /api/auth/turn-credentials, which uses this separate implementation. The older client ICE-order script also remains at 8/18 because it expects a different response/fallback contract.

Impact: a deployment using the hardcoded relay and matching secret may work. A differently configured deployment can use the wrong relay or fail credential retrieval. This audit does not prove that deployed calls are currently broken; no real cross-network media was exercised.

Priority: align the first-party client/handler with the shared provider contract, then test Wi-Fi-to-mobile-data media and credential renewal.

### F5 — Low: nonparticipant group removal returns success

Module: chat/group removal. Source: server/controllers/chatController.js, deleteChat, around line 215.

DELETE /api/chats/:id from an account outside the group returns HTTP 200 rather than rejecting the caller. In this fixture, the group was not deleted, participants remained and updatedAt did not change. Treat this as an access-check/response inconsistency, not proof that outsiders can delete a group.

Priority: add an explicit membership check and retain the existing behavior for legitimate members leaving a group.

## Module-by-module status

“Pass” below means the stated API, state or Socket.IO checks passed. It does not mean every screen was clicked or every possible input was exercised.

| Module | Observed status |
|---|---|
| Signup/login and authenticated access | Existing E2E/new-feature checks pass; real OTP/email transport not verified |
| Sessions/devices/logout | Device registry and revoke-other-devices checks pass; revoked token fails while current session remains usable |
| Two-step PIN and settings/privacy | PIN enable/change/reset, privacy validation and receipt/privacy checks pass |
| Contacts, requests and QR/invites | API/realtime and QR parsing suites pass; contact-declined event lacks separate socket proof |
| Direct chat and message actions | Text/replies/edit/delete/react/star/search/history checks pass; see F3 and F5 for separate boundary findings |
| Groups and roles | Membership/ownership/role and group-call signaling checks pass; nonparticipant removal response is F5 |
| Uploads/images/files | Existing limits and production error responses pass 19/19; video-note cross-route bypass is F3 |
| Voice/video notes and camera | Metadata and upload paths checked; real recording/decoding/playback and physical camera remain pending |
| Presence/typing/read receipts | Presence, privacy and chat realtime suites pass; client deduplication/state tests pass |
| Calls | Ringing, accept/reject/cancel, offer/answer/ICE routing and group mesh checks pass; first-party TURN issue is F4; real media pending |
| Meetings | Visibility, invitations, lobby/admission, collaboration, mesh and capacity suites pass; recording/screen capture and real SFU/media pending |
| Status/stories | Publish/view/privacy/delete/reply realtime checks pass |
| Notifications | In-app contact/message/call/meeting notifications and expired-subscription cleanup pass; push service is mocked, so real OS push is pending |
| Workspace membership/ownership | Team invitation, role restrictions and ownership transfer pass |
| Workspace tasks/activity | Task assignment/completion, foreign-workspace denial and activity permissions pass; task update observed on a real socket |
| Workspace customer inbox | Customer/team access and inbox socket event work; internal-note leak is F1 |
| Workspace guests | Scoped group access, text-only restrictions and immediate revocation checks pass |
| Business storefront/catalog | Profile update and product create/update/delete pass; ordinary-member edit denied |
| Business greeting/away replies | Real local dispatch verified, including single greeting and away cooldown |
| Labels and quick replies | Existing business feature smoke checks pass; picker/autocomplete UI pending |
| Communities | Create/join/topic permissions/leave smoke checks pass |
| Broadcasts | Basic list/delivery smoke checks pass; blocked-recipient delivery is F2 |
| API keys/public API/webhooks | Existing feature suite covers key/scopes/invalid-key and webhook create/use/delete paths; external integrations were not contacted |
| Platform apps/tenant isolation | Provisioning, token exchange, tenant isolation, feature gates, rotation and deletion suites pass |
| Embedded host/SDK | Hosted embed, app-origin protection, token lifecycle, React loader and example host suites pass; production browser permissions pending |
| Super-admin/admin | Super-admin provisioning/repair and admin deletion checks pass |
| Data export/account deletion | Existing export and cleanup checks pass |
| Rate limits/security wiring | Rate-limit keying and embedding-origin checks pass; static client/server routes and event names match |
| Database-load optimization | Isolated load fixture passes response parity, unread freshness, personal-scope separation and indexed pagination checks |
| Frontend/mobile/browser UX | Production build passes; browser backend unavailable, so menus/layout/physical-device UX unverified |

## Test evidence and limits

- 34 primary server suites completed with exit code 0. Their ordinary check counters total 973/973. The admin deletion Node test and database-load fixture are separate successful results without that counter format.
- Upload validation separately passed 19/19.
- Combined SDK/client-store/receipt/upload/coalescer/media unit tests passed 40/40.
- Token store: 20/20; invite parsing: 25/25; embed loader: 37/37.
- Additional cross-module boundary checks: **36/42**. The six failures correspond to F1, F2, F3, F5, and the two parts of F4.
- Legacy client ICE-order script: **8/18**. This remains a failed script; the full repository is not all green.
- API wiring: all 186 client calls match declared routes across 28 routers. Realtime event-name wiring also passes. Static name matching alone does not prove runtime behavior.
- Existing source-level realtime coverage reports 65/74 testable events with a socket assertion. This audit additionally observed workspace inbox/task events. Contact-declined, meeting notes/reminders, breakout invite/return, lower-hand and policy event delivery still need targeted acceptance checks; an untested event is not automatically broken.

The deployment readiness scan reported zero blockers and two warnings: deprecated/unread VITE_TURN_* configuration names, and a value-like string in a local .env comment requiring manual review. No secret value was printed or copied into this report, and no credential leak is asserted from that warning alone.

Logs, fixture results and the extra audit driver are saved under docs/audits/full-module-2026-10-19. Provider-related tests use local test endpoints or simulated failures; they do not certify actual SMTP, Web Push, coturn, Cloudinary, Redis or LiveKit operation.

## Recommended order

Fix F1 and F2 first, then F3 and F4. Address F5 as a small access/response correction. Re-run the corresponding boundary checks and existing regressions before deploying. Real browser/device, cross-network calls and live provider acceptance remain required afterward.

No application fixes were applied during this audit, and nothing was deployed.

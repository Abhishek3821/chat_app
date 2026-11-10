# Chat module audit — 19 October 2026

## Result

The exercised chat API, realtime events and frontend state paths pass after the fixes below. This is **not a full browser/device or production sign-off**. The in-app browser was unavailable, so click-through UI behavior, recording/playback, physical camera/microphone, GPS, push delivery and real cross-network media remain unverified.

Testing used a separate MongoDB process bound to 127.0.0.1:27129 and dedicated local test databases. The application database and server/.env were not modified. Email, Redis, push and cloud storage integrations were disabled for these fixtures. Test users and messages were synthetic.

## Fixed defects

| Defect reproduced or found | Change | Verification |
|---|---|---|
| Data export returned HTTP 500 | Imported the Message model used by the export handler | Export, profile/message contents and private-field checks pass |
| Composer draft storage could throw when browser storage is denied | Used the existing safe storage adapter | Denied/working storage state tests pass; browser rendering remains pending |
| A reply could reference and expose a message from another conversation | Restricted reply targets to visible messages in the same chat; validate live, scheduling and dispatch paths | Foreign-chat, hidden and malformed reply checks pass; valid replies still work |
| Jump-to-message returned an anchor deleted for the requesting user | Applied deletedFor filtering to the anchor lookup | Deleted-message context returns 404 |
| History/search/starred pagination and context jumps omitted messages sharing a timestamp | Added an ID tie-breaker, beforeId cursors and matching query indexes; updated the frontend history/starred callers | Burst fixtures, neighboring context, search and starred pagination pass |
| Blocking a direct-chat peer prevented text but still allowed polls | Applied the direct-message contact/block gate to poll creation | Blocked text and blocked polls both return 403 |
| Failed deletion disappeared locally even though the API refused it | Restore the original message and display an error, preserving concurrent incoming messages | Personal/everyone deletion failure state checks pass |
| Returning from search or reconnecting could retain an exhausted scroll-back flag | Reset history-window/end flags when loading the latest page | Return-to-latest and reconnect state tests pass |

Two existing validation scripts also needed compatibility corrections: the token-store test now supplies its imported embed-mode dependency, and invite helper imports now use explicit .js extensions so the Node test can load them.

## Feature-by-feature status

“API/realtime pass” means requests and/or real Socket.IO peers were exercised. “State pass” means the production client store was run with controlled HTTP responses. Neither label means the UI was clicked in a browser.

| Feature | Result and practical limit |
|---|---|
| Existing session and authenticated chat access | API pass; invalid/foreign access rejected |
| User discovery and contact requests | API/realtime pass |
| Accepting requests and opening direct chats | API/realtime pass |
| Removing contacts and reconnecting later | API/realtime pass; retained history and sending restrictions verified |
| Text, Unicode, emoji and multiline messages | API pass; visual keyboard/emoji picker behavior pending |
| Two-way message delivery without refresh | Real Socket.IO peer checks pass |
| Rapid sends and socket echo deduplication | State pass; distinct optimistic identities retained |
| Offline/failed send | State pass; failed message remains visible; no dedicated retry button was verified |
| Typing start/stop and presence | Realtime pass; browser indicator rendering pending |
| Delivered/read receipts and receipt privacy | API/realtime pass |
| Reply to message | API pass; valid quote and invalid/foreign/hidden quote cases covered |
| Edit own message and refusal of edits by another user | API/realtime pass; failed edit restores original client state |
| Delete for everyone | API/realtime pass; failed client operation rolls back |
| Delete for me | API/state pass; hidden anchor cannot be reopened through context |
| Reactions | API/realtime pass |
| Star/unstar and starred history | API pass, including timestamp ties and exclusion of locked chats in existing search suite |
| Pin/unpin messages | API/realtime pass; durations, expiry visibility, permissions and pin cap exercised |
| Poll creation and voting | API/realtime pass; blocked-user bypass fixed |
| Scheduled messages | Create/list/cancel, realtime status and actual due-message dispatch pass |
| Disappearing messages | Timer update and expiry field assignment pass; actual long-term MongoDB TTL deletion was not timed in this audit |
| View-once media | Recipient consumption and attachment removal pass; screenshot resistance/playback are not claimed |
| Image/video/document/audio/voice/video-note messages | API metadata persistence pass; recording, decoding and playback on devices pending |
| File upload validation | API pass for accepted/invalid/oversized/empty upload cases in the existing suite |
| Camera capture and sending a captured photo | Source reviewed; physical-device/browser check pending |
| Static location sharing | Source/API path reviewed; physical GPS and permission prompts pending |
| Live location start/update/stop | API/realtime pass; physical GPS tracking pending |
| Chat/history search and jump to result | API pass, including access boundaries and equal-timestamp neighbors |
| Scroll-back / return to newest / reconnect | API/state pass; viewport anchoring still needs browser verification |
| Global search | API pass; foreign conversations excluded and missing text-index fallback exercised |
| Chat pin/archive/mute and other-device updates | Existing API/realtime checks pass; actual OS notification suppression not verified |
| Wallpaper and theme persistence | API/realtime pass; visual appearance pending |
| Chat lock / PIN | API pass; full interactive unlock flow pending |
| Clear chat | API pass; requester loses history while peer retains it |
| Group creation, rename and member management | API/realtime pass; ownership/roles and unauthorized actions covered by membership suite |
| Group access for embedded users | Embedded group API/signaling suite passes |
| Mentions and quick replies | Relevant source/wiring reviewed; autocomplete UI and business interaction need browser checks |
| Catalog/product sharing | Existing feature-coverage API checks pass; product-picker UI pending |
| Drafts | Safe storage adapter tested; reload/navigation browser behavior pending |
| QR/invite link parsing | 25/25 pure-function checks pass; physical camera scanner pending |
| Embedded token handshake, renewal and logout cleanup | SDK/loader checks pass; production host browser acceptance pending |
| Audio/video calling | Same-instance signaling, ringing, rejection, cancellation and call-history checks pass; media is not verified |
| Desktop/mobile layout, menus, long press and clipboard | Browser check pending |
| Push/background notifications | Not verified with a real push service/device |

## Automated evidence

Final log totals from 16 server suites: **527/527 checks passed**. These suites also include surrounding account, workspace and business checks; this is a count of assertions, not a claim of 527 distinct chat features.

| Suite | Final checks |
|---|---|
| chat-feature-audit | 29/29 |
| chat-realtime | 41/41 |
| search-wallpaper | 30/30 |
| pinned-messages | 43/43 |
| feature-coverage | 83/83 |
| group-membership | 38/38 |
| upload-validation | 14/14 |
| privacy-settings | 23/23 |
| presence | 20/20 |
| rest-triggered-realtime | 18/18 |
| realtime | 47/47 |
| e2e | 54/54 |
| new-features | 40/40 |
| embed-groups | 22/22 |
| call-edges-realtime | 12/12 |
| relay-delivery | 13/13 — includes expected reproduction of cross-instance failure without Redis |

Additional results: chat store 9/9, embed SDK 16/16, embed loader 37/37, token store 20/20, invite parsing 25/25. The production frontend build and git diff whitespace check pass.

Static wiring checks: all 186 client API calls match declared routes; all 75 server-emitted event names have client handlers, all 69 client listeners match emitted events, and all 21 client-emitted event names have server handlers. Matching names alone is not runtime proof.

New regression sources: client/test-chat-store.mjs and server/tests/chat-feature-audit.mjs. Existing feature-coverage tests were extended for data export.

## Remaining findings and release checks

1. **Legacy ICE test remains red: 8/18.** client/test-ice-order.mjs expects an iceServers-array endpoint response plus static/third-party client fallback settings. The current first-party client calls /api/auth/turn-credentials and consumes urls/username/credential, and does not implement those fallback settings. This is a contract/configuration drift; the failing legacy assertions do not prove that configured same-network or TURN calls fail. Do not call the entire repository test suite green.
2. **First-party TURN configuration needs deployment review.** server/controllers/rtpccred.js hardcodes a relay host and directly uses TURN_SECRET, whereas other ICE routes use the shared provider resolver. This audit did not change call-provider behavior or verify that the deployed credentials and relay match. A missing secret can fail this handler. Verify credentials and a real relay allocation before signing off cross-network calls.
3. **Multiple backend instances need Redis coordination.** The relay-delivery suite deliberately proves that two instances without a Redis adapter can miss cross-instance presence/signaling. Passing that reproduction is not proof of horizontal deployment readiness. The local pass is primarily single-instance behavior.
4. **Browser acceptance remains required.** Run two real users through sending/receiving, menus, recording/playback, camera capture, QR scanning, permission denial, mobile layout, account switching, search scrolling and draft reload. The available browser backend returned no browsers during this audit.
5. **Real media and push remain required.** Test audio/video between Wi-Fi and mobile data with a verified TURN allocation, group media, device switching, background calls, denied camera/mic and real OS push. Check production CDN/storage downloads and browser permission delegation separately.

No production configuration, credentials, database records or deployment were changed. The code fixes are local and have not been deployed.

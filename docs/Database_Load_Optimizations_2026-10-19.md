# Database load optimizations — 19 October 2026

The app keeps its existing screens, response shapes, authentication rules and immediate message delivery. These changes reduce duplicate work; they do not reduce message retention, delay distinct read receipts, change presence timing or add a paid service.

## Changes

1. **Read receipt deduplication.** The socket listener and chat component share a per-socket message watermark. Receiving and rendering the same message sends one read event. New messages send immediately. Reopening a chat forces a fresh read, and reconnecting clears the watermark. Pagination and optimistic outgoing messages do not trigger unnecessary inbound read updates.
2. **Concurrent chat-list work sharing.** Overlapping requests from the same user and the same personal/access scope share one in-flight list build, including population and unread aggregation. Authentication and locked-chat PIN checks still run separately for each request. After a read finishes, the next request starts fresh; no new stale-response window was introduced.
3. **Mutation invalidation.** Existing cache invalidations also detach any older in-flight list builds. A request after a mutation starts a fresh build. An invalidated old build cannot populate the cache through its guarded completion path. Duplicate user IDs are removed before invalidation work.
4. **Index declarations.** Kept the stable compound history and starred-message indexes, and removed three redundant shorter declarations: chat_1, chat_1_createdAt_-1 and starredBy_1_createdAt_-1. Existing live indexes have NOT been dropped. Existing databases need a separate usage review before any physical index removal; source declarations alone do not remove deployed indexes.
5. **Cache configuration.** The existing optional Redis cache and its TTL remain as configured. No Redis service, subscription, authentication cache or new background timer was added.

## Local measurements

The fixture uses a separate local MongoDB process and synthetic messages. Production data and server/.env were not changed.

| Scenario | Observed result |
|---|---|
| Ten sequential identical chat-list builds | 50 database commands |
| Ten overlapping identical chat-list requests | 5 database commands; all ten responses equal |
| Twenty incoming messages, each handled by socket and chat-render paths | 20 immediate read events instead of 40 |
| History query, 40 results from 1,000 messages | 40 documents and 40 keys examined; no collection scan or blocking sort |
| Starred query, 40 results from 1,000 messages | 40 documents and 40 keys examined; no collection scan or blocking sort |

The chat-list count measures controller data work; per-request authentication queries remain outside that count. The ten-request fixture is a concurrency example, not a claim of a 90% reduction across the application or its bill. Separate server instances share their own in-flight work only; this introduces no new cross-instance dependency.

## Verification

- New receipt/coalescer/media-limit tests plus existing chat-store tests: 24/24 passed.
- Ten existing chat/API/realtime regression suites: 379/379 checks passed.
- Local database-load fixture: response parity, fresh unread counts, personal flag isolation and query plans passed.
- Upload validation: 19/19 checks passed, including normal-video compatibility, video-note exact/over-limit cases and production error messages.
- Frontend production build, API-route mapping, realtime-event mapping and whitespace checks passed.

Repeatable sources: client/test-chat-read-receipts.mjs, client/test-chat-store.mjs, server/tests/read-coalescer.test.mjs and server/tests/chat-load.mjs. The load fixture requires a local MONGO_URI and Redis disabled; it refuses remote MongoDB hosts and uses only chatconnect_t_chat_load.

Changes are local and have not been deployed. Actual bill savings depend on production traffic and the hosting plan; no billing-plan change or live database migration was performed. Browser/device acceptance remains outside the available local test environment.

## Media limits checked and video-note cap added

| Media | Limit |
|---|---|
| Images | Existing 10 MB per image |
| Ordinary videos and other allowed files | Existing 50 MB per file |
| Files per upload | Existing maximum 10 |
| Video notes | New 10 MB per file; existing 60-second recording cap |

Video-note uploads use the same authenticated /api/upload route with type=videoNote and a stricter server byte limit. The browser rejects an oversized recording before uploading it and displays the limit. The message/scheduled-message validators also reject supplied video-note size or duration metadata above the cap. The server does not decode recordings to independently measure their duration; the recorder enforces duration in the browser. Existing normal-video/file/image limits and upload calls remain compatible.

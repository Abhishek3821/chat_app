# Audit fixes — 20 October 2026

All five findings from the 19 October full-module audit have been fixed in the
local source. Existing UI and normal messaging flows are retained.

| Finding | Implemented behavior |
|---|---|
| F1: internal inbox notes | Customer creation/follow-up and GET responses use the same serializer without notes. Staff retain access. The duplicate-create retry shares the safe final response. |
| F2: blocked broadcasts | Re-read sender contacts/blocks and recipient contacts/blocks at send time. Blocked recipients are skipped, legitimate delivery and counts remain intact. Invalidate both users' chat-list caches after delivery. |
| F3: forged video-note size | Check actual local file size or URL/byte-count HMAC proof for cloud uploads before live delivery and scheduling; repeat verification at scheduled dispatch. Store proofs on regular and scheduled attachments for forwarding. Legacy owned Cloudinary clips use authenticated provider metadata. |
| F4: first-party ICE configuration | Authenticated endpoint uses the shared coturn/Metered/Cloudflare resolver, provider ordering and TTL. Missing configuration returns STUN-only without throwing. Client accepts the shared array and older response shape; legacy response fields remain available. Credentials have no-store caching. |
| F5: unauthorized chat removal | Reject nonparticipants with 403 before any group or direct-chat mutation. Member leave and personal history clear continue to work. |

## Verification

Tests ran against synthetic accounts in a separate local MongoDB process, with
outbound network blocked and real email/push/provider credentials disabled.

| Suite | Result |
|---|---|
| Cross-module audit regressions | 55/55 |
| Chat feature acceptance | 29/29 |
| Feature coverage, including broadcast and scheduled delivery | 83/83 |
| New features | 40/40 |
| Group membership | 38/38 |
| Shared TURN providers | 79/79 |
| Upload validation, development and production error handling | 19/19 |
| Client ICE contract, ordering, legacy support, concurrent requests and TTL refresh | 23/23 |
| Local/signed upload metadata | 2/2 Node tests |
| Legacy and signed cloud metadata with mocked provider | 4/4 Node tests |
| Existing media-limit, client upload, chat store and read-receipt tests | Passed |
| Frontend production build | Passed |

Logs are in [audits/fixes-2026-10-20](audits/fixes-2026-10-20).
The old 19 October results remain historical evidence; their pre-fix failure
counts do not describe the updated source. The obsolete client ICE expectations
for public frontend provider keys were replaced with explicit checks that those
keys cannot override the authenticated server configuration.

## Practical limits

The video-note limit is 10 MB; ordinary video/files retain 50 MB and images 10 MB.
The recorder stops at 60 seconds and the API rejects declared durations above
60 seconds. Local media is not decoded to independently measure actual duration.
Unverifiable external video-note URLs require uploading through the app first.
Cloudinary legacy metadata requests were simulated in tests.

No deployment or production data/configuration change was performed. Real
cross-network call media, camera/microphone playback, OS push and browser UI
still require device verification; the earlier browser backend was unavailable.

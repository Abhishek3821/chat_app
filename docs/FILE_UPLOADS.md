# File Upload Documentation

Multipart upload, storage drivers, size/type limits, and how uploaded media is access-controlled.

**Related:** [API.md](API.md#uploads--media-access-apiupload) ·
[DATABASE_MODELS.md](DATABASE_MODELS.md#message) (the `attachments[]` shape) ·
[ENVIRONMENT.md](ENVIRONMENT.md#26-storage--uploads)

## 1. Endpoints

`server/routes/uploadRoutes.js` (mounted at `/api/upload` by `server/routes/index.js:52`; the whole router is behind `router.use(protect)`):

| Method | Path | Auth | Multipart field | Single/array | Handler |
|---|---|---|---|---|---|
| `POST` | `/api/upload` | `protect` (Bearer access token or `token` httpOnly cookie; scoped tokens rejected; session must be live) | **`files`** | **array**, `upload.array('files', 10)` → max **10 files/request** | `uploadFiles` (`server/controllers/uploadController.js:9`) |
| `GET` | `/api/upload/access` | `protect` | — | — | `getMediaToken` (`server/controllers/mediaController.js:17`) → mints a 6-hour `scope:'media'` JWT |
| `GET` | `/uploads/:filename` | **Not** `protect`; own token logic. Mounted directly on `app` (`server/server.js:97`), i.e. **outside** `/api`, so it skips `apiLimiter` and `csrfGuard` | — | — | `serveUpload` (`server/controllers/mediaController.js:30`) |

There is exactly **one** upload endpoint — avatars, group avatars, status media and catalog images all reuse `POST /api/upload` and then send back the returned `url` as a plain string field.

`/api/*` is rate-limited by `apiLimiter`: 1000 requests / 15 min per IP (Redis-backed when `REDIS_URL` is set). There is **no** upload-specific limiter.

## 2. Accepted types & size limits

`server/middleware/upload.js:32`:

```js
const ALLOWED = /^\.(jpeg|jpg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|txt)$/;
```

- The gate is the **file extension**, lower-cased, and the regex is **anchored** on purpose — an unanchored list would also admit `.docm`, `.fakepdf`, `.xmp4`.
- **MIME type is not validated at all** (`// mimetype check is loose because browsers vary; extension is the gate`). `file.mimetype` is only *recorded* on the attachment descriptor.

| Category | Extensions | Size limit |
|---|---|---|
| Images | `.jpeg .jpg .png .gif .webp` | 52,428,800 bytes (50 MB) |
| Video | `.mp4 .webm .mov` | 52,428,800 bytes (50 MB) |
| Audio | `.mp3 .wav .ogg .m4a` | 52,428,800 bytes (50 MB) |
| Documents | `.pdf .doc .docx .xls .xlsx .ppt .pptx .txt` | 52,428,800 bytes (50 MB) |
| Archives | `.zip` | 52,428,800 bytes (50 MB) |

**There are no per-type limits.** One global multer limit applies: `limits: { fileSize: 50 * 1024 * 1024 }` = **52,428,800 bytes = 50 MB per file**, plus the `10`-file cap from `upload.array('files', 10)`. Multer's other defaults (fields, parts) are untouched. The `express.json`/`urlencoded` `2mb` caps do **not** apply to multipart bodies.

Downstream caps worth knowing: `MAX_ATTACHMENTS = 20` per message and `MAX_CONTENT = 10_000` chars (`server/controllers/messageController.js:13-14`); broadcast lists cap attachments at 20 (`broadcastController.js:83`), catalog images at 10 (`catalogController.js:68`).

## 3. Storage drivers

`server/utils/storage.js`. Selector:

```js
const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
export function cloudStorageEnabled() {
  return DRIVER === 'cloudinary' && Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
}
```

| Driver | Env | Multer storage | Where bytes land | How served |
|---|---|---|---|---|
| **local** (default) | `STORAGE_DRIVER=local` or unset, **or** `cloudinary` with no credentials (silent fallback) | `multer.diskStorage` | `server/uploads/` — i.e. `D:\office\Office Projects\whatapp clone\server\uploads\`, created with `fs.mkdirSync(recursive)` at import time **only when cloud storage is off** | `GET /uploads/:filename` → `serveUpload`, token + membership gated, `res.sendFile`, `Cache-Control: private, max-age=3600` |
| **cloudinary** | `STORAGE_DRIVER=cloudinary` **and** (`CLOUDINARY_URL` **or** `CLOUDINARY_CLOUD_NAME` [+ `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`]) | `multer.memoryStorage` | `cloudinary.uploader.upload_stream({ folder: 'chatconnect', resource_type: 'auto' })` streamed from `file.buffer` | Public `https` `secure_url` on Cloudinary's CDN — **public-but-unguessable**, *not* membership-gated. Required for a multi-instance fleet (local disk is neither shared nor persistent) |

**No S3 driver exists.** `storage.js:14` and the README describe S3 as a future driver that would slot in behind the same `persistFile()` contract; nothing in the codebase implements it.

Local filenames: `${base}-${Date.now()}-${rand}${ext}` where `base` = the original basename with `[^a-z0-9]/gi` → `_`, truncated to 40 chars, and `ext` = `path.extname(originalname)` preserved verbatim.

## 4. Response shapes

### Success — `POST /api/upload` → **HTTP 201**

Local driver:

```json
{
  "success": true,
  "attachments": [
    {
      "name": "Quarterly Report.pdf",
      "size": 284913,
      "mime": "application/pdf",
      "url": "/uploads/Quarterly_Report-1753876543210-483920174.pdf"
    }
  ]
}
```

Cloudinary driver (adds `width`/`height` from the Cloudinary result; absent for non-visual assets):

```json
{
  "success": true,
  "attachments": [
    {
      "name": "beach.jpg",
      "size": 1048576,
      "mime": "image/jpeg",
      "url": "https://res.cloudinary.com/<cloud>/image/upload/v1753876543/chatconnect/ab12cd34ef.jpg",
      "width": 1920,
      "height": 1080
    }
  ]
}
```

`GET /api/upload/access` → **HTTP 200** `{ "success": true, "token": "<jwt scope=media, 6h>" }`.

### Errors

All errors flow through `errorHandler` (`server/middleware/error.js:8`) → `{ success: false, message, stack? }` (`stack` only in non-production and only for 5xx).

| Condition | Status | Body |
|---|---|---|
| No `files` part at all | **400** | `{"success":false,"message":"No files uploaded."}` (`ApiError`, `isOperational`) |
| Not authenticated | **401** | `{"success":false,"message":"Not authenticated. Please log in."}` |
| Expired/revoked session or a scoped token used as a session | **401** | `{"success":false,"message":"Session expired or invalid. Please log in again."}` / `"Session has been revoked. Please log in again."` |
| Banned / suspended account | **403** | `"This account has been banned."` / `"This account is suspended."` |
| Cross-site POST with a disallowed `Origin`/`Referer` | **403** | `{"success":false,"message":"Cross-site request blocked."}` (`csrfGuard`) |
| **Disallowed extension** — `fileFilter` throws a bare `Error('Unsupported file type.')` with no `statusCode` | **500** ⚠️ | dev: `{"success":false,"message":"Unsupported file type.","stack":"…"}` · prod: `{"success":false,"message":"Something went wrong. Please try again."}` (not `isOperational`, so the real message is masked) |
| **File over 50 MB** — multer `MulterError` `LIMIT_FILE_SIZE` | **500** ⚠️ | dev: `{"success":false,"message":"File too large","stack":"…"}` · prod: masked as above |
| More than 10 files, or a field name other than `files` — `LIMIT_UNEXPECTED_FILE` | **500** ⚠️ | dev: `{"success":false,"message":"Unexpected field","stack":"…"}` · prod: masked |
| Rate limit exceeded | **429** | `{"success":false,"message":"Too many requests, please slow down."}` |
| Cloudinary upload failure | **500** | driver message in dev, masked in prod |

⚠️ Note the real wart: there is **no multer error-handling middleware**, so type/size/count rejections surface as **HTTP 500** and, in production, the client sees a generic message rather than "Unsupported file type" or "File too large". Adding `if (err instanceof multer.MulterError) → 400` (and giving `fileFilter` an `ApiError(415/400)`) is the fix.

`GET /uploads/:filename` errors: **401** `"Media access token required."` · **401** `"Invalid or expired media token."` (includes a session JWT passed via `?token=`, since a query token must have `scope === 'media'`) · **403** `"You do not have access to this file."` (not a participant of the owning chat, or failed the status audience) · **404** `"File not found."`.

## 5. Attaching an upload to a message

`POST /api/messages` with the descriptors returned by the upload:

```json
{
  "chatId": "66f0a1b2c3d4e5f601234567",
  "type": "image",
  "content": "Beach day 🏖️",
  "attachments": [
    { "url": "/uploads/beach-1753876543210-483920174.jpg",
      "name": "beach.jpg", "size": 1048576, "mime": "image/jpeg",
      "width": 1920, "height": 1080 }
  ]
}
```

`sanitizeAttachments()` (`server/controllers/messageController.js:23`) enforces:

- must be an array (else 400 `attachments must be a list.`), at most `MAX_ATTACHMENTS = 20` (else 400 `At most 20 attachments per message.`);
- each entry needs a **string `url` starting `/uploads/` or matching `^https://`** — this blocks `data:`, `javascript:`, plain `http:` and relative-path injection into an auto-loading `<img>`;
- only these keys survive (everything else is dropped): `url, name, size, mime, width, height, duration`.

`type` must be one of `text|image|video|audio|voice|document|location` (`'system'` is server-only). A message needs `content` **or** ≥1 attachment **or** `location`, else 400 `Message cannot be empty.` `viewOnce: true` is honoured only for `image`/`video`.

Persisted shape — `attachmentSchema` in `server/models/Message.js:3` (`{ _id: false }` subdocuments):

```js
{ url: String, name: String, size: Number, mime: String,
  width: Number, height: Number, duration: Number /* seconds, audio/video/voice */ }
```

Indexed as `messageSchema.index({ 'attachments.url': 1 })` — precisely because `serveUpload` looks a file up by URL on **every** media request.

Two purge paths blank `attachments`: `DELETE /api/messages/:id?scope=everyone` (sender, within 5 min) and view-once consumption once every recipient has opened it (`markViewed`, `messageController.js:319`). Neither deletes the bytes from disk/CDN.

## 6. Protected-media access

Two-token design (`server/utils/token.js`, `server/controllers/mediaController.js`):

1. `GET /api/upload/access` (session-authenticated) → `signMediaToken(userId)` = `jwt.sign({ id, scope: 'media' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '6h' })`.
2. The client caches it (`mediaToken` in `client/src/lib/api.js:109`) and `mediaUrl(u)` appends `?token=<encoded>` to any relative `/uploads/...` URL, leaving `http(s):`/`data:`/`blob:` URLs untouched. Rationale: the 30-day-class session JWT must never appear in a URL (history / `Referer` / access logs).
3. `serveUpload` accepts the token from **`?token=`**, the **`token` cookie**, or **`Authorization: Bearer`** — but a token arriving in the **query string must have `scope === 'media'`**; a session JWT there is rejected 401.
4. Gating after the token check:
   - `Message.findOne({ 'attachments.url': '/uploads/<file>' })` → if found, the requester must be a participant of `msg.chat`, else **403**;
   - else `Status.findOne({ media: '/uploads/<file>' })` → if found, `assertAudience(status, userId)` (owner, or a contact permitted by `privacy.type` `everyone|contacts|selected|except`), else **403**;
   - else (avatars, group avatars, catalog images — referenced by no message and no status) → readable by **any** holder of a valid token.
5. Traversal defence: `path.basename(req.params.filename)` strips `../`, plus a `filePath.startsWith(uploadDir)` re-check and an `fs.existsSync` → **404**.
6. `Cache-Control: private, max-age=3600` — deliberately `private`, never `public`, so a CDN/corporate proxy can't store a copy replayable to a different user, while the requesting browser still avoids re-downloading on scrollback.

There is **no signed-URL scheme and no expiry embedded in the path** — the JWT's 6-hour `exp` is the only time bound. Under the Cloudinary driver **none of this applies**: URLs are absolute `https` CDN links, so `mediaUrl()` returns them untouched and access control degrades to "public but unguessable `public_id`" (documented as the intentional trade-off in `storage.js:14`).

## 7. curl examples

```bash
# 0) Log in to get an access token (also sets the httpOnly cookies)
curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"secret123"}'
# → {"success":true,"token":"<ACCESS>", ...}
ACCESS='<ACCESS>'
```

```bash
# 1) POST /api/upload — multipart, field name "files", up to 10 files, 50 MB each
curl -i -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $ACCESS" \
  -F 'files=@./beach.jpg' \
  -F 'files=@./Quarterly Report.pdf'
# → 201 {"success":true,"attachments":[
#      {"name":"beach.jpg","size":1048576,"mime":"image/jpeg",
#       "url":"/uploads/beach-1753876543210-483920174.jpg"},
#      {"name":"Quarterly Report.pdf","size":284913,"mime":"application/pdf",
#       "url":"/uploads/Quarterly_Report-1753876543999-118273645.pdf"}]}
#
# Do NOT set Content-Type manually — curl -F emits the multipart boundary itself.
# curl sends no Origin header, so csrfGuard lets it through; a browser-origin
# request must come from CLIENT_URL / EXTRA_CORS_ORIGINS.
```

```bash
# 1b) Rejection cases (both currently 500 — see the note in §4)
curl -i -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $ACCESS" -F 'files=@./payload.exe'
# → 500 {"success":false,"message":"Unsupported file type.","stack":"..."}   (dev)

curl -i -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $ACCESS" -F 'files=@./movie-80mb.mp4'
# → 500 {"success":false,"message":"File too large","stack":"..."}           (dev)

curl -i -X POST http://localhost:5000/api/upload -H "Authorization: Bearer $ACCESS"
# → 400 {"success":false,"message":"No files uploaded."}
```

```bash
# 2) GET /api/upload/access — mint the short-lived media token
curl -s http://localhost:5000/api/upload/access -H "Authorization: Bearer $ACCESS"
# → {"success":true,"token":"<MEDIA>"}
MEDIA='<MEDIA>'
```

```bash
# 3) GET /uploads/:filename — three interchangeable auth forms
curl -i "http://localhost:5000/uploads/beach-1753876543210-483920174.jpg?token=$MEDIA" -o beach.jpg
curl -i  http://localhost:5000/uploads/beach-1753876543210-483920174.jpg -H "Authorization: Bearer $ACCESS" -o beach.jpg
curl -i  http://localhost:5000/uploads/beach-1753876543210-483920174.jpg --cookie "token=$ACCESS" -o beach.jpg
# → 200, Cache-Control: private, max-age=3600
# ?token=$ACCESS (session JWT in the query) → 401 "Invalid or expired media token."
# non-participant of the owning chat                → 403 "You do not have access to this file."
```

```bash
# 4) Attach the upload to a message
curl -s -X POST http://localhost:5000/api/messages \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"chatId":"66f0a1b2c3d4e5f601234567","type":"image","content":"Beach day",
       "attachments":[{"url":"/uploads/beach-1753876543210-483920174.jpg",
                       "name":"beach.jpg","size":1048576,"mime":"image/jpeg",
                       "width":1920,"height":1080}]}'
# → 201 {"success":true,"message":{...}} and a `receive-message` socket event to
#   every participant's `user:<id>` room (+ `chat-updated` to everyone but the sender)
```
agentId: af2ec358727d0d549 (use SendMessage with to: 'af2ec358727d0d549', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 169536
tool_uses: 34
duration_ms: 490908</usage>
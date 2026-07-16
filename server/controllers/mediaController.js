import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Message from '../models/Message.js';
import Chat from '../models/Chat.js';
import Status from '../models/Status.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { verifyToken, signMediaToken } from '../utils/token.js';
import { assertAudience } from './statusController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

// GET /api/upload/access  (protected) — mint a short-lived, media-only token the
// client appends to <img>/<video> src URLs (so the 30-day session JWT never ends
// up in a URL / browser history / referrer).
export const getMediaToken = asyncHandler(async (req, res) => {
  res.json({ success: true, token: signMediaToken(req.user._id) });
});

/**
 * GET /uploads/:filename — authenticated file serving.
 *
 * Replaces the old public `express.static('/uploads')`, which made every
 * uploaded file world-readable by URL. Now the caller must present a valid
 * token AND, for any file referenced by a chat message, be a participant of
 * that chat (per-conversation isolation). Avatars / status media (not tied to a
 * message) are readable by any authenticated user.
 */
export const serveUpload = asyncHandler(async (req, res) => {
  const filename = path.basename(req.params.filename); // strip any ../ traversal

  const raw =
    req.query.token ||
    req.cookies?.token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!raw) throw new ApiError(401, 'Media access token required.');

  let userId;
  try {
    const decoded = verifyToken(raw);
    // A token arriving via the query string must be the short-lived media token —
    // never the 30-day session JWT (URLs leak via history/referrers/logs).
    if (req.query.token && decoded.scope !== 'media') throw new Error('wrong scope');
    userId = decoded.id;
  } catch {
    throw new ApiError(401, 'Invalid or expired media token.');
  }

  const rel = `/uploads/${filename}`;
  const msg = await Message.findOne({ 'attachments.url': rel }).select('chat');
  if (msg) {
    // Chat attachment → must be a participant of the owning conversation.
    const member = await Chat.findOne({ _id: msg.chat, 'participants.user': userId }).select('_id');
    if (!member) throw new ApiError(403, 'You do not have access to this file.');
  } else {
    // Status media → must pass the status's privacy audience (owner / allowed
    // contacts), matching the /api/status checks. Avatars (referenced by no
    // message or status) remain readable by any authenticated user.
    const status = await Status.findOne({ media: rel }).select('user privacy');
    if (status) await assertAudience(status, userId); // throws 403 if not allowed
  }

  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir) || !fs.existsSync(filePath)) throw new ApiError(404, 'File not found.');
  res.sendFile(filePath);
});

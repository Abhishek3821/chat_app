import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { persistFile } from '../utils/storage.js';

/**
 * POST /api/upload  (multipart, field: "files")
 * Returns attachment descriptors. STORAGE_DRIVER decides where bytes land:
 * "local" → auth-gated /uploads; "cloudinary" → CDN (see utils/storage.js).
 */
export const uploadFiles = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw new ApiError(400, 'No files uploaded.');

  const attachments = await Promise.all(req.files.map((f) => persistFile(f)));

  res.status(201).json({ success: true, attachments });
});

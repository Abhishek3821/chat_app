import { asyncHandler, ApiError } from '../utils/asyncHandler.js';

/**
 * POST /api/upload  (multipart, field: "files")
 * Returns attachment descriptors for the uploaded files. When STORAGE_DRIVER
 * is "local" the files are served from /uploads. (Cloudinary hook left as a
 * documented extension point.)
 */
export const uploadFiles = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw new ApiError(400, 'No files uploaded.');

  const attachments = req.files.map((f) => ({
    url: `/uploads/${f.filename}`,
    name: f.originalname,
    size: f.size,
    mime: f.mimetype,
  }));

  res.status(201).json({ success: true, attachments });
});

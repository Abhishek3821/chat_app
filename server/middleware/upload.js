import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { cloudStorageEnabled } from '../utils/storage.js';
import { ApiError } from '../utils/asyncHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

// Only need a local directory when we're actually writing to disk.
if (!cloudStorageEnabled() && !fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9]/gi, '_')
      .slice(0, 40);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

// Cloud driver keeps bytes in memory so persistFile() can stream them to the CDN;
// local driver writes straight to disk.
const storage = cloudStorageEnabled() ? multer.memoryStorage() : diskStorage;

// Anchored: the WHOLE extension must match — an unanchored list would also pass
// lookalikes that merely contain an allowed word (".docm", ".fakepdf", ".xmp4").
// `.enc` is an attachment sealed for an end-to-end encrypted chat. The bytes are
// AES-GCM ciphertext this server cannot open, and its real name/type live on the
// message rather than in the filename — so it must be listed here, because the
// extension is the gate. Keep in step with the client's ALLOWED_UPLOAD_EXT.
const ALLOWED = /^\.(jpeg|jpg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|txt|enc)$/;

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES = 10;

function fileFilter(req, file, cb) {
  const extOk = ALLOWED.test(path.extname(file.originalname).toLowerCase());
  // mimetype check is loose because browsers vary; extension is the gate.
  if (extOk) return cb(null, true);
  // ApiError (not a bare Error) so the central handler answers 400 with this
  // text. A bare Error has no statusCode → 500, and in production the handler
  // replaces non-operational 5xx messages with a generic string, so the caller
  // would never learn *why* the upload was refused.
  cb(new ApiError(400, 'Unsupported file type.'));
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

/**
 * Translate multer's own MulterErrors into user-facing 4xx responses.
 * Mount directly after the `upload.*()` middleware — multer rejects with a
 * MulterError carrying only a `code`, which would otherwise surface as a 500.
 */
export function handleUploadErrors(err, _req, _res, next) {
  if (!(err instanceof multer.MulterError)) return next(err);
  const mb = Math.round(MAX_FILE_BYTES / (1024 * 1024));
  const messages = {
    LIMIT_FILE_SIZE: `File too large. Each file must be under ${mb} MB.`,
    LIMIT_FILE_COUNT: `Too many files. At most ${MAX_FILES} per upload.`,
    LIMIT_UNEXPECTED_FILE: 'Unexpected file field — use "files".',
    LIMIT_PART_COUNT: 'Too many parts in the upload.',
    LIMIT_FIELD_KEY: 'Upload field name is too long.',
    LIMIT_FIELD_VALUE: 'Upload field value is too long.',
    LIMIT_FIELD_COUNT: 'Too many fields in the upload.',
  };
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  return next(new ApiError(status, messages[err.code] || 'Upload rejected.'));
}

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { cloudStorageEnabled } from '../utils/storage.js';

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
const ALLOWED = /^\.(jpeg|jpg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|txt)$/;

function fileFilter(req, file, cb) {
  const extOk = ALLOWED.test(path.extname(file.originalname).toLowerCase());
  // mimetype check is loose because browsers vary; extension is the gate.
  if (extOk) return cb(null, true);
  cb(new Error('Unsupported file type.'));
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

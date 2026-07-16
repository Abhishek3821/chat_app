import { v2 as cloudinary } from 'cloudinary';

/**
 * Upload storage driver.
 *   • local (default)    → files on disk, served by the auth-gated /uploads route
 *                          (per-chat access control preserved).
 *   • cloudinary         → files pushed to Cloudinary's CDN; attachment URLs
 *                          become public https links (unguessable public_ids).
 *                          Required for a horizontally-scaled fleet, since local
 *                          disk isn't shared between instances and is ephemeral.
 *
 * TRADE-OFF: cloud URLs are public-but-unguessable rather than membership-gated.
 * That's the standard messaging-app trade-off; keep `local` if strict per-file
 * authorization matters more than multi-instance scaling. An S3 driver can slot
 * in here behind the same persistFile() contract.
 */
const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

export function cloudStorageEnabled() {
  return DRIVER === 'cloudinary' && Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
}

if (cloudStorageEnabled() && process.env.CLOUDINARY_CLOUD_NAME) {
  // If CLOUDINARY_URL is set, the SDK reads it automatically; this handles the
  // split-variable form.
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Turn a Multer file into an attachment descriptor, uploading to the cloud when enabled. */
export async function persistFile(file) {
  const base = { name: file.originalname, size: file.size, mime: file.mimetype };
  if (cloudStorageEnabled()) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'chatconnect', resource_type: 'auto' },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return { ...base, url: result.secure_url, width: result.width, height: result.height };
  }
  // Local disk: multer already wrote the file; expose its gated URL.
  return { ...base, url: `/uploads/${file.filename}` };
}

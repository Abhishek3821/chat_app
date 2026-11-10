import crypto from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './asyncHandler.js';
import { MAX_VIDEO_NOTE_BYTES, MAX_VIDEO_NOTE_SECONDS } from './mediaLimits.js';
import { inspectCloudVideo } from './storage.js';

const uploadDir = fileURLToPath(new URL('../uploads/', import.meta.url));
const signature = (url, size) => crypto.createHmac('sha256', process.env.JWT_SECRET)
  .update(JSON.stringify(['upload-v1', url, size])).digest('hex');

// Signed metadata travels with cloud attachments and survives forwarding and
// scheduling. It contains no credentials and requires no extra database reads.
export function signUpload(attachment) {
  return { ...attachment, uploadProof: signature(attachment.url, attachment.size) };
}

export async function verifyVideoNoteAttachments(attachments) {
  for (const attachment of attachments || []) {
    let size;
    if (attachment.url.startsWith('/uploads/')) {
      const name = attachment.url.slice('/uploads/'.length);
      if (!name || name !== path.basename(name) || /[\\?#%]/.test(name)) {
        throw new ApiError(400, 'Invalid video note upload.');
      }
      try {
        const file = await stat(path.join(uploadDir, name));
        if (!file.isFile()) throw new Error('Not a file');
        size = file.size;
      } catch {
        throw new ApiError(400, 'Video note upload is unavailable. Please upload it again.');
      }
    } else {
      const proof = attachment.uploadProof;
      if (!Number.isSafeInteger(attachment.size) || attachment.size < 0 ||
          typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof) ||
          !crypto.timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(signature(attachment.url, attachment.size), 'hex'))) {
        // Older cloud attachments predate proofs. Verify with the configured
        // provider so forwarding an existing clip does not require re-uploading.
        let legacy;
        try { legacy = await inspectCloudVideo(attachment.url); } catch { /* unavailable */ }
        if (!legacy || !Number.isSafeInteger(legacy.size) || legacy.size < 0) {
          throw new ApiError(400, 'Video note upload could not be verified. Please upload it again.');
        }
        attachment.size = legacy.size;
        attachment.duration = legacy.duration ?? attachment.duration;
        attachment.uploadProof = signature(attachment.url, attachment.size);
      }
      size = attachment.size;
    }
    if (size > MAX_VIDEO_NOTE_BYTES || Number(attachment.duration) > MAX_VIDEO_NOTE_SECONDS) {
      throw new ApiError(400, 'Video notes can be up to 10 MB and 60 seconds.');
    }
    attachment.size = size;
  }
}

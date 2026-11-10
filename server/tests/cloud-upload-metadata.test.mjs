import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';

process.env.STORAGE_DRIVER = 'cloudinary';
process.env.CLOUDINARY_URL = '';
process.env.CLOUDINARY_CLOUD_NAME = 'audit-cloud';
process.env.CLOUDINARY_API_KEY = 'audit-key';
process.env.CLOUDINARY_API_SECRET = 'audit-secret';
process.env.JWT_SECRET = 'audit-upload-proof-secret';
const { signUpload, verifyVideoNoteAttachments } = await import('../utils/uploadMetadata.js');
const url = 'https://res.cloudinary.com/audit-cloud/video/upload/v123/chatconnect/note.webm';
let calls = 0, bytes = 1024, duration = 30;
const original = cloudinary.api.resource;
cloudinary.api.resource = async (id, options) => {
  calls++;
  assert.equal(id, 'chatconnect/note');
  assert.equal(options.resource_type, 'video');
  return { bytes, duration };
};
test.after(() => { cloudinary.api.resource = original; });

test('legacy owned cloud note is verified and can subsequently be forwarded without a provider read', async () => {
  const attachment = { url, size: 1 };
  await verifyVideoNoteAttachments([attachment]);
  assert.equal(attachment.size, 1024);
  assert.equal(attachment.duration, 30);
  assert.equal(calls, 1);
  await verifyVideoNoteAttachments([{ ...attachment }]);
  assert.equal(calls, 1);
});
test('legacy provider byte count and duration override forged metadata', async () => {
  bytes = 11 * 1024 * 1024;
  await assert.rejects(verifyVideoNoteAttachments([{ url, size: 1 }]), /10 MB/);
  bytes = 1024; duration = 61;
  await assert.rejects(verifyVideoNoteAttachments([{ url, duration: 1 }]), /60 seconds/);
  duration = 30;
});
test('untrusted URLs and other cloud accounts never trigger a provider call', async () => {
  const before = calls;
  for (const value of ['https://evil.invalid/note', url.replace('audit-cloud', 'other-cloud'), url.replace('note.webm', '%2e%2e/secret')]) {
    await assert.rejects(verifyVideoNoteAttachments([{ url: value, size: 1 }]), /verified/);
  }
  assert.equal(calls, before);
});
test('new signed cloud uploads require no provider lookup', async () => {
  const before = calls;
  await verifyVideoNoteAttachments([signUpload({ url, size: 1024, duration: 30 })]);
  assert.equal(calls, before);
});

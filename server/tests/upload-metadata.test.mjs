import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { signUpload, verifyVideoNoteAttachments } from '../utils/uploadMetadata.js';

process.env.JWT_SECRET ||= 'local-upload-proof-test-only-secret';
const note = (size = 1024) => signUpload({ url: 'https://example.invalid/note.webm', size, duration: 60 });

test('cloud upload proof binds the URL and byte count; valid forwarding keeps working', async () => {
  const valid = note(10 * 1024 * 1024);
  await verifyVideoNoteAttachments([valid]);
  await verifyVideoNoteAttachments([{ ...valid }]);
  for (const change of [{ size: 1 }, { size: undefined }, { size: -1 }, { url: 'https://example.invalid/other.webm' }, { uploadProof: undefined }]) {
    await assert.rejects(verifyVideoNoteAttachments([{ ...valid, ...change }]), /verified/);
  }
  await assert.rejects(verifyVideoNoteAttachments([note(10 * 1024 * 1024 + 1)]), /10 MB/);
  await assert.rejects(verifyVideoNoteAttachments([{ ...note(), duration: 61 }]), /60 seconds/);
});

test('local byte verification ignores forged metadata and blocks path traversal', async () => {
  const name = `proof-test-${process.pid}.webm`;
  const file = new URL('../uploads/' + name, import.meta.url);
  try {
    await writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1));
    for (const size of [1, undefined, -1]) {
      await assert.rejects(verifyVideoNoteAttachments([{ url: '/uploads/' + name, size }]), /10 MB/);
    }
    await writeFile(file, Buffer.alloc(10 * 1024 * 1024));
    const attachment = { url: '/uploads/' + name, size: 1, duration: 60 };
    await verifyVideoNoteAttachments([attachment]);
    assert.equal(attachment.size, 10 * 1024 * 1024);
    for (const url of ['/uploads/../.env', '/uploads/%2e%2e/.env', '/uploads/a?token=x', '/uploads/a\\b']) {
      await assert.rejects(verifyVideoNoteAttachments([{ url }]), /Invalid/);
    }
  } finally { await unlink(file).catch(() => {}); }
});

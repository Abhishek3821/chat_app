import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let finish;
mock.module('nodemailer', { defaultExport: {
  createTransport: () => ({ sendMail: () => new Promise((resolve, reject) => { finish = { resolve, reject }; }), close() {} }),
} });
const { sendEmailWithin, closeEmailTransport } = await import('../utils/sendEmail.js');

test('signup can wait past the usual deadline and receive a late SMTP rejection', async () => {
  process.env.EMAIL_HOST = 'smtp.example.invalid';
  process.env.EMAIL_USER = 'sender@example.invalid';
  process.env.EMAIL_PASS = 'test-only';
  delete process.env.BREVO_API_KEY;
  let settled = false;
  const pending = sendEmailWithin({ to: 'recipient@example.invalid', text: 'test' }, null)
    .then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(settled, false);
  const error = Object.assign(new Error('535 invalid login'), { responseCode: 535 });
  finish.reject(error);
  const result = await pending;
  assert.equal(result.state, 'failed');
  assert.equal(result.error, error);
  closeEmailTransport();
});

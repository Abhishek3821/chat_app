// No database or provider traffic. Run:
// node --experimental-test-module-mocks --test tests/forgot-password.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let configured = true, outcome = 'sent', mails = [], events = [];
mock.module('../utils/sendEmail.js', { namedExports: {
  isEmailConfigured: () => configured,
  sendEmailWithin: async mail => { mails.push(mail); return { state: outcome }; },
  otpEmailTemplate: () => '', classifySendError: () => 'other',
} });
mock.module('../utils/securityLog.js', { namedExports: {
  securityEvent: (event, _req, meta) => events.push({ event, ...meta }),
} });
const { forgotPassword } = await import('../controllers/authController.js');
const { default: User } = await import('../models/User.js');
const result = async email => {
  let body, error;
  await forgotPassword({ body: { email } }, { json: data => { body = data; } }, err => { error = err; });
  return { body, error };
};
const user = () => ({ _id: 'fixture-user', email: 'recovery@example.invalid', save: async () => {} });

test.beforeEach(() => {
  configured = true; outcome = 'sent'; mails = []; events = [];
  process.env.CLIENT_URL = 'https://chat.example.invalid';
});

test('provider sent, failed, pending and logged results never claim inbox delivery or expose account existence', async t => {
  let found;
  t.mock.method(User, 'findOne', async () => found);
  const unknown = await result('unknown@example.invalid');
  assert.equal(unknown.error, undefined);
  assert.equal(unknown.body.deliveryConfirmed, false);
  for (outcome of ['sent', 'failed', 'pending', 'logged']) {
    found = user();
    const response = await result(found.email);
    assert.equal(response.error, undefined);
    assert.deepEqual(response.body, unknown.body);
    assert.match(response.body.message, /delivery is not confirmed/i);
    assert.doesNotMatch(response.body.message, /has been sent|we sent/i);
  }
  assert.equal(mails.length, 4);
  assert.equal(events.length, 2);
  assert.ok(events.every(e => !JSON.stringify(e).includes('/reset-password/')));
});

test('unconfigured email returns a readable 503 for every account without querying users or attempting email', async t => {
  configured = false;
  const lookup = t.mock.method(User, 'findOne', async () => { throw new Error('Must not query'); });
  for (const email of ['recovery@example.invalid', 'unknown@example.invalid']) {
    const response = await result(email);
    assert.equal(response.error?.statusCode, 503);
    assert.match(response.error.message, /temporarily unavailable/);
    assert.equal(response.body, undefined);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(mails.length, 0);
});

test('a valid request normalizes email and stores only an expiring hash while the email contains the usable link', async t => {
  const account = user(); let query;
  t.mock.method(User, 'findOne', async filter => { query = filter; return account; });
  const before = Date.now();
  assert.equal((await result('  RECOVERY@example.invalid  ')).error, undefined);
  assert.deepEqual(query, { email: account.email });
  const token = /\/reset-password\/([a-f0-9]{64})/.exec(mails[0].text)?.[1];
  assert.ok(token);
  assert.equal(account.resetPasswordToken, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(account.resetPasswordToken, token);
  assert.ok(account.resetPasswordExpires >= before + 30 * 60 * 1000);
  assert.ok(account.resetPasswordExpires <= Date.now() + 30 * 60 * 1000);
  assert.equal(mails[0].to, account.email);
});

test('invalid email input returns 400 before account lookup or provider access', async t => {
  const lookup = t.mock.method(User, 'findOne', async () => { throw new Error('Must not query'); });
  for (const email of [undefined, null, {}, '', 'invalid']) {
    assert.equal((await result(email)).error?.statusCode, 400);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(mails.length, 0);
});

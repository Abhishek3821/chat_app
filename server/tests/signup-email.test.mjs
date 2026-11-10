// node --experimental-test-module-mocks --test server/tests/signup-email.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let state = 'sent', deadline;
mock.module('../utils/sendEmail.js', { namedExports: {
  isEmailConfigured: () => true,
  sendEmailWithin: async (_mail, wait) => { deadline = wait; return { state, error: new Error('535 invalid login') }; },
  otpEmailTemplate: () => '', classifySendError: () => 'auth',
} });
mock.module('../utils/securityLog.js', { namedExports: { securityEvent: () => {} } });
const { sendSignupEmailCode } = await import('../controllers/authController.js');
const { default: User } = await import('../models/User.js');
const { default: EmailVerification } = await import('../models/EmailVerification.js');

test('signup waits for provider acceptance and surfaces rejected credentials', async t => {
  t.mock.method(User, 'exists', async () => false);
  t.mock.method(EmailVerification, 'findOneAndUpdate', async () => ({}));
  for (state of ['failed', 'sent']) {
    let body, error;
    await sendSignupEmailCode({ body: { email: 'signup@example.invalid' } },
      { json: data => { body = data; } }, err => { error = err; });
    assert.equal(deadline, null);
    if (state === 'failed') {
      assert.equal(error?.statusCode, 502);
      assert.match(error.message, /email login/);
      assert.equal(body, undefined);
    } else {
      assert.equal(error, undefined);
      assert.equal(body.success, true);
    }
  }
});

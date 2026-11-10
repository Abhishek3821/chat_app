import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the page's real submission handler without a browser/JSX runtime.
const source = fs.readFileSync(new URL('./src/pages/auth/ForgotPassword.jsx', import.meta.url), 'utf8');
const body = /const sendLink = async \(\) => \{([\s\S]*?)\n  \};/.exec(source)?.[1];
assert.ok(body, 'ForgotPassword submission handler must be available');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const run = new AsyncFunction('forgotPassword', 'email', 'setSubmitting', 'setSubmitted', 'toast', body);
function state(submitted = false) {
  const value = { submitted, submitting: false, notices: [], errors: [] };
  const toast = message => value.notices.push(message);
  toast.error = message => value.errors.push(message);
  return { value, args: [' recovery@example.invalid ', flag => { value.submitting = flag; }, flag => { value.submitted = flag; }, toast] };
}
test('acknowledged request uses neutral delivery-unconfirmed notice', async () => {
  const s = state(); let email;
  await run(async address => { email = address; return { success: true, deliveryConfirmed: false }; }, ...s.args);
  assert.equal(email, 'recovery@example.invalid');
  assert.equal(s.value.submitted, true);
  assert.equal(s.value.submitting, false);
  assert.match(s.value.notices[0], /delivery is not confirmed/i);
  assert.equal(s.value.errors.length, 0);
});
test('service error is shown and a failed resend returns to the request form', async () => {
  const s = state(true);
  await run(async () => { throw { message: 'Request failed with status code 503', response: { data: { message: 'Password reset email is temporarily unavailable. Please try again later.' } } }; }, ...s.args);
  assert.equal(s.value.submitted, false);
  assert.equal(s.value.submitting, false);
  assert.match(s.value.errors[0], /temporarily unavailable/);
  assert.equal(s.value.notices.length, 0);
});
test('a pending HTTP request keeps controls busy and a network error never shows success', async () => {
  const s = state(); let reject;
  const request = run(() => new Promise((_resolve, fail) => { reject = fail; }), ...s.args);
  assert.equal(s.value.submitting, true);
  assert.equal(s.value.submitted, false);
  reject(new Error('Network unavailable'));
  await request;
  assert.equal(s.value.submitting, false);
  assert.equal(s.value.submitted, false);
  assert.deepEqual(s.value.errors, ['Network unavailable']);
  assert.equal(s.value.notices.length, 0);
});

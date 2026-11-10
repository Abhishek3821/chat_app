# Forgot-password acknowledgement fix - 20 October 2026

The recovery page no longer claims a reset email was sent or presents a green
delivery-confirmation icon. A successful request shows "Reset request received"
with explicit delivery-unconfirmed wording and a retry action. Network/service
errors show the server's readable message and keep/return the user to the form,
including when a resend fails.

The API validates email syntax and rejects an unconfigured email service with
503 before looking up any account. For configured delivery, sent, pending,
failed, logged and unknown-account cases share the same acknowledgement, with
deliveryConfirmed: false. This preserves account-existence privacy: returning
different delivery errors only for registered addresses would reveal accounts.
Immediate failed/logged attempts record a security event without the reset link.
The email transport already logs eventual provider failures, including those
after the short response deadline. Provider acceptance never proves inbox arrival.

Existing reset-token hashing, 30-minute expiry and password-reset completion are
unchanged. No provider email or production account change was triggered.

Validation: 4 backend tests cover all provider results, unknown accounts,
unconfigured transport, normalized addresses, hashed tokens/expiry and invalid
input. 3 frontend handler tests cover request acknowledgement, 503/resend failure
and pending/network-failure behavior. All 7 pass; frontend production build passes.
Actual inbox delivery remains unverified.

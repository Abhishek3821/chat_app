import { Router } from 'express';
import {
  signup,
  verifyOtp,
  resendOtp,
  login,
  verifyLoginOtp,
  resendLoginOtp,
  googleAuth,
  logout,
  getMe,
  forgotPassword ,
  resetPassword ,
  changePassword,
  enableTwoStep,
  changeTwoStepPin,
  disableTwoStep,
  verifyTwoStep,
  requestTwoStepReset,
  resetTwoStepPin,
  refresh,
  listSessions,
  revokeSession,
  revokeOtherSessions,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/signup', authLimiter, signup);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/resend-otp', authLimiter, resendOtp);
router.post('/login', authLimiter, login);
// Login second factor: OTP sent to the phone (email fallback).
router.post('/login/verify-otp', authLimiter, verifyLoginOtp);
router.post('/login/resend-otp', authLimiter, resendLoginOtp);
router.post('/google', authLimiter, googleAuth); // sign in / up with a Google ID token
router.post('/logout', protect, logout);
router.post('/refresh', authLimiter, refresh); // authenticated by the refresh cookie
router.get('/me', protect, getMe);

// Session management (secure session handling)
router.get('/sessions', protect, listSessions);
router.post('/sessions/revoke-others', protect, revokeOtherSessions);
router.delete('/sessions/:id', protect, revokeSession);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);
router.patch('/change-password', protect, changePassword);

// Two-step verification (app-lock PIN). Verify is rate-limited (brute force).
router.post('/two-step/enable', protect, enableTwoStep);
// Changing the PIN requires the current PIN (rate-limited: guessing surface).
router.post('/two-step/change', protect, authLimiter, changeTwoStepPin);
router.post('/two-step/disable', protect, disableTwoStep);
router.post('/two-step/verify', protect, authLimiter, verifyTwoStep);
// Forgot PIN → reset it with an email OTP (both rate-limited).
router.post('/two-step/forgot', protect, authLimiter, requestTwoStepReset);
router.post('/two-step/reset', protect, authLimiter, resetTwoStepPin);

export default router;

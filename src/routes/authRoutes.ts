import { Router } from 'express';
import {
  requestSignupOtp,
  signup,
  login,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  getGoogleAuthUrl,
  googleCallback,
} from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// OTP-based Signup verification flow
router.post('/signup-otp', authLimiter, requestSignupOtp);
router.post('/signup', authLimiter, signup);

// Standard credentials auth
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', authMiddleware, getMe);

// Password recovery
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

// Google OAuth
router.get('/google/url', getGoogleAuthUrl);
router.get('/google/callback', googleCallback);

export default router;

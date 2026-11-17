import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  sendOtpEmail,
  sendWelcomeEmail,
  sendLoginAlertEmail,
  sendPasswordResetEmail,
} from '../services/mail.js';
import { AuthRequest } from '../middleware/auth.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function generateToken(user: { id: number; email: string }) {
  return jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as any,
  });
}

// Generate secure 6-digit numeric OTP
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. Request Signup OTP Controller
export async function requestSignupOtp(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const { email } = req.body;
  logger.info({ controller: 'requestSignupOtp', action: 'initialized', email }, '[RequestOTP] Initialized');

  if (!email) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'requestSignupOtp', action: 'validation_failed', durationMs: elapsed }, '[RequestOTP] Missing email');
    res.status(400).json({ success: false, message: 'Email is required' });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'requestSignupOtp', email: normalizedEmail, durationMs: elapsed }, '[RequestOTP] User already exists');
      res.status(409).json({ success: false, message: 'An account with this email already exists' });
      return;
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any previous unverified OTPs for this email
    await pool.query(
      'DELETE FROM otp_verifications WHERE email = $1 AND purpose = $2',
      [normalizedEmail, 'signup']
    );

    // Save new OTP
    await pool.query(
      'INSERT INTO otp_verifications (email, otp, purpose, expires_at) VALUES ($1, $2, $3, $4)',
      [normalizedEmail, otp, 'signup', expiresAt]
    );

    // Send email notification with OTP
    await sendOtpEmail(normalizedEmail, otp);

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'requestSignupOtp', action: 'completed', email: normalizedEmail, durationMs: elapsed },
      `[RequestOTP] Completed in ${elapsed}ms`
    );

    res.json({
      success: true,
      message: 'Verification OTP sent to your email (valid for 10 minutes).',
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'requestSignupOtp', error: error.message, stack: error.stack, durationMs: elapsed },
      `[RequestOTP] Error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 2. Complete Signup with OTP Controller
export async function signup(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'signup', action: 'initialized', email: req.body?.email }, '[Signup] Controller initialized');

  const { name, email, password, otp } = req.body;

  if (!name || !email || !password || !otp) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'signup', action: 'validation_failed', durationMs: elapsed }, '[Signup] Missing required fields or OTP');
    res.status(400).json({ success: false, message: 'Name, email, password, and OTP are required' });
    return;
  }

  if (password.length < 6) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'signup', action: 'validation_failed', durationMs: elapsed }, '[Signup] Password too short');
    res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Verify OTP
    const otpResult = await pool.query(
      `SELECT id FROM otp_verifications 
       WHERE email = $1 AND otp = $2 AND purpose = 'signup' AND is_verified = FALSE AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail, otp.trim()]
    );

    if (otpResult.rows.length === 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'signup', action: 'invalid_otp', email: normalizedEmail, durationMs: elapsed }, '[Signup] Invalid or expired OTP');
      res.status(400).json({ success: false, message: 'Invalid or expired OTP code' });
      return;
    }

    // Mark OTP as verified
    await pool.query('UPDATE otp_verifications SET is_verified = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    // Re-check existing user
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'signup', email: normalizedEmail, durationMs: elapsed }, '[Signup] User already exists');
      res.status(409).json({ success: false, message: 'User with this email already exists' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, email, avatar_url, created_at`,
      [name.trim(), normalizedEmail, passwordHash]
    );

    const newUser = result.rows[0];

    // Audit fields: set created_by / updated_by
    await pool.query(
      'UPDATE users SET created_by = $1, updated_by = $1 WHERE id = $1',
      [newUser.id]
    );

    // Send Welcome Email Notification
    sendWelcomeEmail(newUser.email, newUser.name).catch((err) =>
      logger.error({ err }, '[Signup] Failed to send welcome email')
    );

    const token = generateToken(newUser);
    res.cookie('token', token, COOKIE_OPTIONS);

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'signup', action: 'completed', userId: newUser.id, email: newUser.email, durationMs: elapsed },
      `[Signup] Completed successfully in ${elapsed}ms`
    );

    res.status(201).json({
      success: true,
      message: 'Signup verified and completed successfully',
      user: newUser,
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'signup', error: error.message, stack: error.stack, durationMs: elapsed },
      `[Signup] Failed with error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 3. Login Controller
export async function login(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'login', action: 'initialized', email: req.body?.email }, '[Login] Controller initialized');

  const { email, password } = req.body;

  if (!email || !password) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'login', action: 'validation_failed', durationMs: elapsed }, '[Login] Missing email or password');
    res.status(400).json({ success: false, message: 'Email and password are required' });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      'SELECT id, name, email, password_hash, avatar_url FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'login', action: 'auth_failed', email: normalizedEmail, durationMs: elapsed }, '[Login] User not found');
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'login', action: 'oauth_account_password_attempt', userId: user.id, durationMs: elapsed }, '[Login] OAuth account requires Google login');
      res.status(400).json({
        success: false,
        message: 'This account was created with Google OAuth. Please sign in with Google.',
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'login', action: 'auth_failed', userId: user.id, durationMs: elapsed }, '[Login] Incorrect password');
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    // Send Login Security Alert Email
    sendLoginAlertEmail(user.email, user.name, 'Email & Password').catch((err) =>
      logger.error({ err }, '[Login] Failed to send login alert email')
    );

    const token = generateToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);

    const { password_hash, ...safeUser } = user;
    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'login', action: 'completed', userId: safeUser.id, durationMs: elapsed },
      `[Login] Completed successfully in ${elapsed}ms`
    );

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: safeUser,
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'login', error: error.message, stack: error.stack, durationMs: elapsed },
      `[Login] Failed with error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 4. Logout Controller
export async function logout(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'logout', action: 'initialized' }, '[Logout] Controller initialized');

  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
  });

  const elapsed = Date.now() - startTime;
  logger.info({ controller: 'logout', action: 'completed', durationMs: elapsed }, `[Logout] Completed in ${elapsed}ms`);
  res.json({ success: true, message: 'Logged out successfully' });
}

// 5. Get Current User (/me)
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const userId = req.user?.id;
  logger.info({ controller: 'getMe', action: 'initialized', userId }, '[GetMe] Controller initialized');

  try {
    const result = await pool.query(
      'SELECT id, name, email, avatar_url, created_at FROM users WHERE id = $1 AND is_deleted = FALSE',
      [userId]
    );

    if (result.rows.length === 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'getMe', action: 'user_not_found', userId, durationMs: elapsed }, '[GetMe] User not found');
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'getMe', action: 'completed', userId, durationMs: elapsed }, `[GetMe] Completed in ${elapsed}ms`);
    res.json({ success: true, user: result.rows[0] });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'getMe', userId, error: error.message, stack: error.stack, durationMs: elapsed },
      `[GetMe] Failed with error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 6. Forgot Password Controller
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'forgotPassword', action: 'initialized', email: req.body?.email }, '[ForgotPassword] Controller initialized');

  const { email } = req.body;
  if (!email) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'forgotPassword', action: 'validation_failed', durationMs: elapsed }, '[ForgotPassword] Missing email');
    res.status(400).json({ success: false, message: 'Email is required' });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      const elapsed = Date.now() - startTime;
      logger.info({ controller: 'forgotPassword', email: normalizedEmail, durationMs: elapsed }, '[ForgotPassword] User does not exist, silent return');
      res.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.',
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE email = $3',
      [resetToken, expiry, normalizedEmail]
    );

    await sendPasswordResetEmail(normalizedEmail, resetToken);

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'forgotPassword', action: 'completed', email: normalizedEmail, durationMs: elapsed },
      `[ForgotPassword] Reset link dispatched in ${elapsed}ms`
    );

    res.json({
      success: true,
      message: 'Password reset link sent to your email (or check terminal if credentials not yet configured).',
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'forgotPassword', error: error.message, stack: error.stack, durationMs: elapsed },
      `[ForgotPassword] Failed with error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 7. Reset Password Controller
export async function resetPassword(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'resetPassword', action: 'initialized' }, '[ResetPassword] Controller initialized');

  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'resetPassword', action: 'validation_failed', durationMs: elapsed }, '[ResetPassword] Missing token or password');
    res.status(400).json({ success: false, message: 'Token and new password are required' });
    return;
  }

  if (newPassword.length < 6) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'resetPassword', action: 'validation_failed', durationMs: elapsed }, '[ResetPassword] Password too short');
    res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expiry > CURRENT_TIMESTAMP AND is_deleted = FALSE',
      [token]
    );

    if (result.rows.length === 0) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'resetPassword', action: 'invalid_or_expired_token', durationMs: elapsed }, '[ResetPassword] Invalid or expired token');
      res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      return;
    }

    const user = result.rows[0];
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE users 
       SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, updated_by = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'resetPassword', action: 'completed', userId: user.id, durationMs: elapsed },
      `[ResetPassword] Completed successfully in ${elapsed}ms`
    );

    res.json({ success: true, message: 'Password has been reset successfully. Please log in.' });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'resetPassword', error: error.message, stack: error.stack, durationMs: elapsed },
      `[ResetPassword] Failed with error in ${elapsed}ms`
    );
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// 8. Google OAuth URL generator
export async function getGoogleAuthUrl(_req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'getGoogleAuthUrl', action: 'initialized' }, '[GoogleAuthUrl] Controller initialized');

  if (!config.google.clientId) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'getGoogleAuthUrl', error: 'Missing GOOGLE_CLIENT_ID', durationMs: elapsed }, '[GoogleAuthUrl] Google Client ID not configured');
    res.status(400).json({
      success: false,
      message: 'Google Client ID is not configured in backend/.env',
    });
    return;
  }

  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: config.google.redirectUri,
    client_id: config.google.clientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  const qs = new URLSearchParams(options);
  const elapsed = Date.now() - startTime;
  logger.info({ controller: 'getGoogleAuthUrl', action: 'completed', durationMs: elapsed }, `[GoogleAuthUrl] Completed in ${elapsed}ms`);
  res.json({ success: true, url: `${rootUrl}?${qs.toString()}` });
}

// 9. Google OAuth Callback
export async function googleCallback(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'googleCallback', action: 'initialized' }, '[GoogleCallback] Controller initialized');

  const code = req.query.code as string;

  if (!code) {
    const elapsed = Date.now() - startTime;
    logger.warn({ controller: 'googleCallback', action: 'no_code', durationMs: elapsed }, '[GoogleCallback] Missing authorization code');
    res.redirect(`${config.clientUrl}/login?error=Google authentication failed: no code provided`);
    return;
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to exchange Google OAuth code');
    }

    // Fetch user profile from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = (await userResponse.json()) as any;
    const { id: googleId, email, name, picture } = googleUser;

    if (!email) {
      const elapsed = Date.now() - startTime;
      logger.warn({ controller: 'googleCallback', action: 'no_email_in_profile', durationMs: elapsed }, '[GoogleCallback] Google profile missing email');
      res.redirect(`${config.clientUrl}/login?error=Google account has no email`);
      return;
    }

    // Check if user exists by google_id or email
    let userResult = await pool.query(
      'SELECT id, name, email, avatar_url FROM users WHERE (google_id = $1 OR email = $2) AND is_deleted = FALSE',
      [googleId, email.toLowerCase()]
    );

    let user;
    let isNewUser = false;
    if (userResult.rows.length === 0) {
      isNewUser = true;
      // Create new user
      const insertResult = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name, email, avatar_url`,
        [name || 'Google User', email.toLowerCase(), googleId, picture]
      );
      user = insertResult.rows[0];

      // Audit fields: set created_by / updated_by
      await pool.query(
        'UPDATE users SET created_by = $1, updated_by = $1 WHERE id = $1',
        [user.id]
      );

      // Send Welcome Email
      sendWelcomeEmail(user.email, user.name).catch((err) =>
        logger.error({ err }, '[GoogleOAuth] Failed to send welcome email')
      );
    } else {
      // Update google_id and avatar if missing
      user = userResult.rows[0];
      await pool.query(
        `UPDATE users SET google_id = COALESCE(google_id, $1), avatar_url = COALESCE(avatar_url, $2), updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [googleId, picture, user.id]
      );
    }

    // Send Login Security Alert Email
    if (!isNewUser) {
      sendLoginAlertEmail(user.email, user.name, 'Google OAuth').catch((err) =>
        logger.error({ err }, '[GoogleOAuth] Failed to send login alert email')
      );
    }

    // Issue JWT cookie and redirect to client
    const token = generateToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: 'googleCallback', action: 'completed', userId: user.id, isNewUser, durationMs: elapsed },
      `[GoogleCallback] Completed successfully in ${elapsed}ms`
    );

    res.redirect(`${config.clientUrl}/`);
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      { controller: 'googleCallback', error: error.message, stack: error.stack, durationMs: elapsed },
      `[GoogleCallback] Failed with error in ${elapsed}ms`
    );
    res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(error.message || 'Google Auth Error')}`);
  }
}

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db/index.js";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  sendOtpEmail,
  sendWelcomeEmail,
  sendLoginAlertEmail,
  sendPasswordResetEmail,
} from "../services/mail.js";
import { AuthRequest } from "../middleware/auth.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function generateToken(user: { id: number; email: string }): string {
  try {
    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.jwtSecret,
      {
        expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
      },
    );
    logger.debug({ userId: user.id }, "[Auth] JWT generated successfully");
    return token;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(
      { userId: user.id, error: message, stack },
      "[Auth] Failed to generate JWT",
    );
    throw err;
  }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getErrorInfo(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export async function requestSignupOtp(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const { email } = (req.body ?? {}) as { email?: string };
  logger.info(
    { controller: "requestSignupOtp", action: "initialized" },
    "[RequestOTP] Initialized",
  );

  if (!email) {
    logger.warn(
      {
        controller: "requestSignupOtp",
        action: "validation_failed",
        reason: "missing_email",
        durationMs: Date.now() - startTime,
      },
      "[RequestOTP] Missing email",
    );
    res.status(400).json({ success: false, message: "Email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE",
      [normalizedEmail],
    );

    if (existing.rows.length > 0) {
      logger.warn(
        {
          controller: "requestSignupOtp",
          action: "user_exists",
          durationMs: Date.now() - startTime,
        },
        "[RequestOTP] User already exists",
      );
      res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
      return;
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      "DELETE FROM otp_verifications WHERE email = $1 AND purpose = $2",
      [normalizedEmail, "signup"],
    );

    await pool.query(
      "INSERT INTO otp_verifications (email, otp, purpose, expires_at) VALUES ($1, $2, $3, $4)",
      [normalizedEmail, otp, "signup", expiresAt],
    );

    await sendOtpEmail(normalizedEmail, otp);

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "requestSignupOtp",
        action: "completed",
        durationMs: elapsed,
      },
      `[RequestOTP] Completed in ${elapsed}ms`,
    );

    res.json({
      success: true,
      message: "Verification OTP sent to your email (valid for 10 minutes).",
    });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "requestSignupOtp",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[RequestOTP] Error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function signup(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const body = (req.body ?? {}) as {
    name?: string;
    email?: string;
    password?: string;
    otp?: string;
  };
  logger.info(
    { controller: "signup", action: "initialized" },
    "[Signup] Controller initialized",
  );

  const { name, email, password, otp } = body;

  if (!name || !email || !password || !otp) {
    logger.warn(
      {
        controller: "signup",
        action: "validation_failed",
        reason: "missing_fields",
        durationMs: Date.now() - startTime,
      },
      "[Signup] Missing required fields or OTP",
    );
    res.status(400).json({
      success: false,
      message: "Name, email, password, and OTP are required",
    });
    return;
  }

  if (password.length < 6) {
    logger.warn(
      {
        controller: "signup",
        action: "validation_failed",
        reason: "password_too_short",
        durationMs: Date.now() - startTime,
      },
      "[Signup] Password too short",
    );
    res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();

    const otpResult = await pool.query(
      `SELECT id FROM otp_verifications
       WHERE email = $1 AND otp = $2 AND purpose = 'signup' AND is_verified = FALSE AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail, otp.trim()],
    );

    if (otpResult.rows.length === 0) {
      logger.warn(
        {
          controller: "signup",
          action: "invalid_otp",
          durationMs: Date.now() - startTime,
        },
        "[Signup] Invalid or expired OTP",
      );
      res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP code" });
      return;
    }

    const otpId = otpResult.rows[0].id as number;
    await pool.query(
      "UPDATE otp_verifications SET is_verified = TRUE WHERE id = $1",
      [otpId],
    );

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE",
      [normalizedEmail],
    );

    if (existing.rows.length > 0) {
      logger.warn(
        {
          controller: "signup",
          action: "user_exists",
          durationMs: Date.now() - startTime,
        },
        "[Signup] User already exists",
      );
      res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, email, avatar_url, created_at`,
      [name.trim(), normalizedEmail, passwordHash],
    );

    const newUser = result.rows[0] as {
      id: number;
      name: string;
      email: string;
      avatar_url: string | null;
      created_at: Date;
    };

    await pool.query(
      "UPDATE users SET created_by = $1, updated_by = $1 WHERE id = $1",
      [newUser.id],
    );

    sendWelcomeEmail(newUser.email, newUser.name).catch((err: unknown) => {
      const { message, stack } = getErrorInfo(err);
      logger.error(
        {
          controller: "signup",
          userId: newUser.id,
          error: message,
          stack,
        },
        "[Signup] Failed to send welcome email",
      );
    });

    const token = generateToken({ id: newUser.id, email: newUser.email });
    res.cookie(config.authCookieName, token, COOKIE_OPTIONS);

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "signup",
        action: "completed",
        userId: newUser.id,
        durationMs: elapsed,
      },
      `[Signup] Completed successfully in ${elapsed}ms`,
    );

    res.status(201).json({
      success: true,
      message: "Signup verified and completed successfully",
      user: newUser,
    });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "signup",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[Signup] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const body = (req.body ?? {}) as { email?: string; password?: string };
  logger.info(
    { controller: "login", action: "initialized" },
    "[Login] Controller initialized",
  );

  const { email, password } = body;

  if (!email || !password) {
    logger.warn(
      {
        controller: "login",
        action: "validation_failed",
        reason: "missing_credentials",
        durationMs: Date.now() - startTime,
      },
      "[Login] Missing email or password",
    );
    res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      "SELECT id, name, email, password_hash, avatar_url FROM users WHERE email = $1 AND is_deleted = FALSE",
      [normalizedEmail],
    );

    if (result.rows.length === 0) {
      logger.warn(
        {
          controller: "login",
          action: "auth_failed",
          reason: "user_not_found",
          durationMs: Date.now() - startTime,
        },
        "[Login] User not found",
      );
      res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
      return;
    }

    const user = result.rows[0] as {
      id: number;
      name: string;
      email: string;
      password_hash: string | null;
      avatar_url: string | null;
    };

    if (!user.password_hash) {
      logger.warn(
        {
          controller: "login",
          action: "oauth_account_password_attempt",
          userId: user.id,
          durationMs: Date.now() - startTime,
        },
        "[Login] OAuth account requires Google login",
      );
      res.status(400).json({
        success: false,
        message:
          "This account was created with Google OAuth. Please sign in with Google.",
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logger.warn(
        {
          controller: "login",
          action: "auth_failed",
          reason: "incorrect_password",
          userId: user.id,
          durationMs: Date.now() - startTime,
        },
        "[Login] Incorrect password",
      );
      res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
      return;
    }

    sendLoginAlertEmail(user.email, user.name, "Email & Password").catch(
      (err: unknown) => {
        const { message, stack } = getErrorInfo(err);
        logger.error(
          {
            controller: "login",
            userId: user.id,
            error: message,
            stack,
          },
          "[Login] Failed to send login alert email",
        );
      },
    );

    const token = generateToken({ id: user.id, email: user.email });
    res.cookie(config.authCookieName, token, COOKIE_OPTIONS);

    const { password_hash: _passwordHash, ...safeUser } = user;
    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "login",
        action: "completed",
        userId: safeUser.id,
        durationMs: elapsed,
      },
      `[Login] Completed successfully in ${elapsed}ms`,
    );

    res.json({
      success: true,
      message: "Logged in successfully",
      user: safeUser,
    });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "login",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[Login] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const userId = (req as AuthRequest).user?.id;
  logger.info(
    { controller: "logout", action: "initialized", userId },
    "[Logout] Controller initialized",
  );

  try {
    res.clearCookie(config.authCookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "logout",
        action: "completed",
        userId,
        durationMs: elapsed,
      },
      `[Logout] Completed in ${elapsed}ms`,
    );
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "logout",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[Logout] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({ success: false, message: "Failed to logout" });
  }
}

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const userId = req.user?.id;
  logger.info(
    { controller: "getMe", action: "initialized", userId },
    "[GetMe] Controller initialized",
  );

  if (!userId) {
    logger.warn(
      {
        controller: "getMe",
        action: "unauthenticated",
        durationMs: Date.now() - startTime,
      },
      "[GetMe] Missing authenticated user",
    );
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email, avatar_url, created_at FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId],
    );

    if (result.rows.length === 0) {
      logger.warn(
        {
          controller: "getMe",
          action: "user_not_found",
          userId,
          durationMs: Date.now() - startTime,
        },
        "[GetMe] User not found",
      );
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      { controller: "getMe", action: "completed", userId, durationMs: elapsed },
      `[GetMe] Completed in ${elapsed}ms`,
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "getMe",
        userId,
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[GetMe] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const { email } = (req.body ?? {}) as { email?: string };
  logger.info(
    { controller: "forgotPassword", action: "initialized" },
    "[ForgotPassword] Controller initialized",
  );

  if (!email) {
    logger.warn(
      {
        controller: "forgotPassword",
        action: "validation_failed",
        reason: "missing_email",
        durationMs: Date.now() - startTime,
      },
      "[ForgotPassword] Missing email",
    );
    res.status(400).json({ success: false, message: "Email is required" });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      "SELECT id, email FROM users WHERE email = $1 AND is_deleted = FALSE",
      [normalizedEmail],
    );

    if (result.rows.length === 0) {
      logger.info(
        {
          controller: "forgotPassword",
          action: "user_not_found_silent_return",
          durationMs: Date.now() - startTime,
        },
        "[ForgotPassword] User does not exist, silent return",
      );
      res.json({
        success: true,
        message:
          "If an account exists with this email, a reset link has been sent.",
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 3600000);

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE email = $3",
      [resetToken, expiry, normalizedEmail],
    );

    await sendPasswordResetEmail(normalizedEmail, resetToken);

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "forgotPassword",
        action: "completed",
        durationMs: elapsed,
      },
      `[ForgotPassword] Reset link dispatched in ${elapsed}ms`,
    );

    res.json({
      success: true,
      message:
        "Password reset link sent to your email (or check terminal if credentials not yet configured).",
    });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "forgotPassword",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[ForgotPassword] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const { token, newPassword } = (req.body ?? {}) as {
    token?: string;
    newPassword?: string;
  };
  logger.info(
    { controller: "resetPassword", action: "initialized" },
    "[ResetPassword] Controller initialized",
  );

  if (!token || !newPassword) {
    logger.warn(
      {
        controller: "resetPassword",
        action: "validation_failed",
        reason: "missing_fields",
        durationMs: Date.now() - startTime,
      },
      "[ResetPassword] Missing token or password",
    );
    res
      .status(400)
      .json({ success: false, message: "Token and new password are required" });
    return;
  }

  if (newPassword.length < 6) {
    logger.warn(
      {
        controller: "resetPassword",
        action: "validation_failed",
        reason: "password_too_short",
        durationMs: Date.now() - startTime,
      },
      "[ResetPassword] Password too short",
    );
    res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expiry > CURRENT_TIMESTAMP AND is_deleted = FALSE",
      [token],
    );

    if (result.rows.length === 0) {
      logger.warn(
        {
          controller: "resetPassword",
          action: "invalid_or_expired_token",
          durationMs: Date.now() - startTime,
        },
        "[ResetPassword] Invalid or expired token",
      );
      res
        .status(400)
        .json({ success: false, message: "Invalid or expired reset token" });
      return;
    }

    const user = result.rows[0] as { id: number; email: string };
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, updated_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, user.id],
    );

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "resetPassword",
        action: "completed",
        userId: user.id,
        durationMs: elapsed,
      },
      `[ResetPassword] Completed successfully in ${elapsed}ms`,
    );

    res.json({
      success: true,
      message: "Password has been reset successfully. Please log in.",
    });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "resetPassword",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[ResetPassword] Failed with error in ${elapsed}ms`,
    );
    res.status(500).json({
      success: false,
      message: message || "Internal server error",
    });
  }
}

export async function getGoogleAuthUrl(
  _req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  logger.info(
    { controller: "getGoogleAuthUrl", action: "initialized" },
    "[GoogleAuthUrl] Controller initialized",
  );

  if (!config.google.clientId) {
    logger.error(
      {
        controller: "getGoogleAuthUrl",
        error: "Missing GOOGLE_CLIENT_ID",
        durationMs: Date.now() - startTime,
      },
      "[GoogleAuthUrl] Google Client ID not configured",
    );
    res.status(400).json({
      success: false,
      message: "Google Client ID is not configured in backend/.env",
    });
    return;
  }

  try {
    const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
    const params = new URLSearchParams({
      redirect_uri: config.google.redirectUri,
      client_id: config.google.clientId,
      access_type: "offline",
      response_type: "code",
      prompt: "select_account",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
    });

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "getGoogleAuthUrl",
        action: "completed",
        durationMs: elapsed,
      },
      `[GoogleAuthUrl] Completed in ${elapsed}ms`,
    );
    res.json({ success: true, url: `${rootUrl}?${params.toString()}` });
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "getGoogleAuthUrl",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[GoogleAuthUrl] Failed with error in ${elapsed}ms`,
    );
    res
      .status(500)
      .json({ success: false, message: "Failed to generate Google auth URL" });
  }
}

export async function googleCallback(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  logger.info(
    { controller: "googleCallback", action: "initialized" },
    "[GoogleCallback] Controller initialized",
  );

  const code = typeof req.query.code === "string" ? req.query.code : undefined;

  if (!code) {
    logger.warn(
      {
        controller: "googleCallback",
        action: "no_code",
        durationMs: Date.now() - startTime,
      },
      "[GoogleCallback] Missing authorization code",
    );
    res.redirect(
      `${config.clientUrl}/login?error=Google authentication failed: no code provided`,
    );
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      throw new Error(
        tokenData.error_description ||
          tokenData.error ||
          "Failed to exchange Google OAuth code",
      );
    }

    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );

    if (!userResponse.ok) {
      throw new Error("Failed to fetch Google user profile");
    }

    const googleUser = (await userResponse.json()) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const { id: googleId, email, name, picture } = googleUser;

    if (!email) {
      logger.warn(
        {
          controller: "googleCallback",
          action: "no_email_in_profile",
          durationMs: Date.now() - startTime,
        },
        "[GoogleCallback] Google profile missing email",
      );
      res.redirect(
        `${config.clientUrl}/login?error=Google account has no email`,
      );
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userResult = await pool.query(
      "SELECT id, name, email, avatar_url FROM users WHERE (google_id = $1 OR email = $2) AND is_deleted = FALSE",
      [googleId ?? null, normalizedEmail],
    );

    let user: {
      id: number;
      name: string;
      email: string;
      avatar_url: string | null;
    };
    let isNewUser = false;

    if (userResult.rows.length === 0) {
      isNewUser = true;
      const insertResult = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name, email, avatar_url`,
        [
          name || "Google User",
          normalizedEmail,
          googleId ?? null,
          picture ?? null,
        ],
      );
      user = insertResult.rows[0] as {
        id: number;
        name: string;
        email: string;
        avatar_url: string | null;
      };

      await pool.query(
        "UPDATE users SET created_by = $1, updated_by = $1 WHERE id = $1",
        [user.id],
      );

      sendWelcomeEmail(user.email, user.name).catch((err: unknown) => {
        const { message, stack } = getErrorInfo(err);
        logger.error(
          {
            controller: "googleCallback",
            userId: user.id,
            error: message,
            stack,
          },
          "[GoogleOAuth] Failed to send welcome email",
        );
      });
    } else {
      user = userResult.rows[0] as {
        id: number;
        name: string;
        email: string;
        avatar_url: string | null;
      };
      await pool.query(
        `UPDATE users SET google_id = COALESCE(google_id, $1), avatar_url = COALESCE(avatar_url, $2), updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [googleId ?? null, picture ?? null, user.id],
      );
    }

    if (!isNewUser) {
      sendLoginAlertEmail(user.email, user.name, "Google OAuth").catch(
        (err: unknown) => {
          const { message, stack } = getErrorInfo(err);
          logger.error(
            {
              controller: "googleCallback",
              userId: user.id,
              error: message,
              stack,
            },
            "[GoogleOAuth] Failed to send login alert email",
          );
        },
      );
    }

    const token = generateToken({ id: user.id, email: user.email });
    res.cookie(config.authCookieName, token, COOKIE_OPTIONS);

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        controller: "googleCallback",
        action: "completed",
        userId: user.id,
        isNewUser,
        durationMs: elapsed,
      },
      `[GoogleCallback] Completed successfully in ${elapsed}ms`,
    );

    res.redirect(`${config.clientUrl}/`);
  } catch (error: unknown) {
    const { message, stack } = getErrorInfo(error);
    const elapsed = Date.now() - startTime;
    logger.error(
      {
        controller: "googleCallback",
        error: message,
        stack,
        durationMs: elapsed,
      },
      `[GoogleCallback] Failed with error in ${elapsed}ms`,
    );
    res.redirect(
      `${config.clientUrl}/login?error=${encodeURIComponent(message || "Google Auth Error")}`,
    );
  }
}

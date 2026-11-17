import nodemailer, { SendMailOptions } from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

// Nodemailer configured with service: 'gmail' using email + password (app password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

// Helper to safely send email with fallback console logging
async function sendMailSafe(options: SendMailOptions, fallbackMsg: string) {
  if (!config.email.user || !config.email.pass) {
    logger.info(`[Email Simulation (No EMAIL_USER/EMAIL_PASS)]: ${fallbackMsg}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"Poongodi Farm Products" <${config.email.user}>`,
      ...options,
    });
    logger.info({ to: options.to, subject: options.subject }, '[Email Sent] Successfully delivered');
  } catch (err: any) {
    logger.error({ err: err.message, to: options.to }, '[Email Error] Failed to send email via SMTP');
    logger.info(`[Email Fallback]: ${fallbackMsg}`);
  }
}

// 1. Send OTP for signup
export async function sendOtpEmail(toEmail: string, otp: string) {
  const fallbackMsg = `OTP for ${toEmail}: [ ${otp} ] (Valid for 10 minutes)`;
  const mailOptions = {
    to: toEmail,
    subject: 'Poongodi Farm Products - Your Signup Verification Code',
    text: `Your verification code is: ${otp}. It is valid for 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">Poongodi Farm Products</h2>
        <p>Use the following 6-digit OTP code to complete your signup registration:</p>
        <div style="margin: 20px 0; background: #f1f5f9; padding: 16px; border-radius: 6px; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
      </div>
    `,
  };

  await sendMailSafe(mailOptions, fallbackMsg);
}

// 2. Welcome Email on Signup
export async function sendWelcomeEmail(toEmail: string, name: string) {
  const fallbackMsg = `Welcome email for ${name} (${toEmail})`;
  const mailOptions = {
    to: toEmail,
    subject: 'Welcome to Poongodi Farm Products! 🎉',
    text: `Hi ${name}, welcome to Poongodi Farm Products! Your account has been created successfully.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">Welcome to Poongodi Farm Products, ${name}! 🎉</h2>
        <p>Thank you for joining Poongodi Farm Products. Your account has been registered and verified successfully.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">If you ever need help or have questions, feel free to reply directly to this email.</p>
      </div>
    `,
  };

  await sendMailSafe(mailOptions, fallbackMsg);
}

// 3. New Login Alert Email
export async function sendLoginAlertEmail(toEmail: string, name: string, loginMethod: string) {
  const fallbackMsg = `New login alert for ${name} (${toEmail}) via ${loginMethod}`;
  const now = new Date().toUTCString();
  const mailOptions = {
    to: toEmail,
    subject: 'Security Alert: New Sign-in Detected',
    text: `Hi ${name}, a new sign-in was detected for your account on ${now} via ${loginMethod}.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h3 style="color: #0f172a; margin-top: 0;">New Sign-In Detected</h3>
        <p>Hi ${name},</p>
        <p>We noticed a new login to your account:</p>
        <ul style="color: #475569; font-size: 14px;">
          <li><strong>Method:</strong> ${loginMethod}</li>
          <li><strong>Time:</strong> ${now}</li>
        </ul>
        <p style="color: #64748b; font-size: 13px; margin-top: 20px;">If this was you, you can safely disregard this email. If you did not log in, please reset your password immediately.</p>
      </div>
    `,
  };

  await sendMailSafe(mailOptions, fallbackMsg);
}

// 4. Password Reset Email
export async function sendPasswordResetEmail(toEmail: string, resetToken: string) {
  const resetUrl = `${config.clientUrl}/reset-password?token=${resetToken}`;
  const fallbackMsg = `Password Reset Link for ${toEmail}: ${resetUrl}`;

  const mailOptions = {
    to: toEmail,
    subject: 'Poongodi Farm Products - Password Reset Request',
    text: `You requested a password reset for your Poongodi Farm Products account. Click this link: ${resetUrl}\n\nValid for 1 hour.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">Poongodi Farm Products</h2>
        <p>You requested a password reset. Click the button below to set a new password:</p>
        <div style="margin: 24px 0;">
          <a href="${resetUrl}" style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #64748b; font-size: 13px;">Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; color: #2563eb; font-size: 13px;">${resetUrl}</p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };

  await sendMailSafe(mailOptions, fallbackMsg);
}

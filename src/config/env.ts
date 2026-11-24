import dotenv from 'dotenv';
dotenv.config();

// Support both FRONTEND_URL and CLIENT_URL from env
const rawFrontendUrls =  process.env.CLIENT_URL || 'http://localhost:5173';

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  authCookieName: process.env.AUTH_COOKIE_NAME || 'token',
  clientUrl: rawFrontendUrls.split(',')[0].trim().replace(/\/$/, ''),
  clientUrls: rawFrontendUrls
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/poongodi_auth',
  jwtSecret: process.env.JWT_SECRET || 'super_secret_jwt_key_poongodi_12345',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
  },
  email: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
  },
};

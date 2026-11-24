import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';

import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { httpLogger } from './middleware/requestLogger.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import farmRoutes from './routes/farmRoutes.js';

const app = express();

// 1. Trust proxy if behind a reverse proxy (e.g. Vercel)
app.set('trust proxy', 1);

// 2. CORS configuration with multi-client support & credentials
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, '');
      const isAllowed = config.clientUrls.some((allowed) => {
        if (allowed === '*') return true;
        return (
          allowed === normalizedOrigin ||
          normalizedOrigin.startsWith(allowed) ||
          (allowed.includes('localhost') && normalizedOrigin.includes('localhost'))
        );
      });

      if (isAllowed) {
        return callback(null, true);
      }

      logger.warn({ origin, allowedOrigins: config.clientUrls }, '[CORS] Blocked request from unauthorized origin');
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  })
);

// 3. Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 4. Response compression
app.use(compression());

// 5. Pino HTTP Request Logger
app.use(httpLogger);

// 6. Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 7. Cookie Parser for JWT authentication
app.use(cookieParser());

// 8. Prevent HTTP Parameter Pollution attacks
app.use(hpp());

// 9. Global Rate Limiter
app.use('/api', generalLimiter);

// Root endpoint — Application Status
app.get('/', (_req, res) => {
  res.json({
    status: 'running',
    service: 'Poongodi Farm Products Backend API',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// Health check endpoints
const healthHandler = (_req: express.Request, res: express.Response) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: 'Poongodi Farm Products Backend API',
    environment: config.nodeEnv,
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Authentication routes
app.use('/api/auth', authRoutes);

// Admin Orders & Analytics routes
app.use('/api/orders', orderRoutes);

// Farm Business, Quails, Feeds & Expense Management routes
app.use('/api/farm', farmRoutes);

// 10. 404 Route Not Found Handler
app.use(notFoundHandler);

// 11. Centralized Global Error Handler
app.use(errorHandler);

// Export the Express app as default for Vercel serverless functions
export default app;
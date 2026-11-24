import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';

import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { initDb } from './db/index.js';
import { httpLogger } from './middleware/requestLogger.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import farmRoutes from './routes/farmRoutes.js';
import { initFeedCronJob } from './services/feedCron.js';

const app = express();

// 1. Trust proxy if behind a reverse proxy (e.g. Nginx, Heroku, Railway, Vercel)
app.set('trust proxy', 1);

// 2. CORS configuration with multi-client support & credentials (MUST be before helmet and routes)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
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

// 3. Security headers (configure helmet to allow CORS and cross-origin embedding)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 4. Response compression (gzip/brotli)
app.use(compression());

// 5. Pino HTTP Request Logger (assigns X-Request-Id and pretty-prints logs)
app.use(httpLogger);

// 6. Body parsers with sensible size limits (prevents payload flood)
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

// Health check endpoints (both /health and /api/health)
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

// Server startup
async function start() {
  await initDb();
  initFeedCronJob();
  app.listen(config.port, () => {
    logger.info(`Backend server running at http://localhost:${config.port}`);
    logger.info(`Client URL: ${config.clientUrl}`);
    logger.info(`Pino HTTP logging & security middlewares enabled`);
  });
}

// Catch unexpected process exceptions
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception detected! Shutting down...');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection detected!');
});

start();

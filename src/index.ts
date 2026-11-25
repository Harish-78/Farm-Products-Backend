import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import hpp from "hpp";

import { config } from "./config/env.js";
import { logger } from "./config/logger.js";
import { httpLogger } from "./middleware/requestLogger.js";
import { authLimiter, generalLimiter } from "./middleware/rateLimiter.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import farmRoutes from "./routes/farmRoutes.js";
import { getAllUsers } from "./controllers/authController.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = config.clientUrls.some((allowed) => {
        if (allowed === "*") return true;
        return (
          allowed === normalizedOrigin ||
          normalizedOrigin.startsWith(allowed) ||
          (allowed.includes("localhost") &&
            normalizedOrigin.includes("localhost"))
        );
      });

      if (isAllowed) {
        return callback(null, true);
      }

      logger.warn(
        { origin, allowedOrigins: config.clientUrls },
        "[CORS] Blocked request from unauthorized origin",
      );
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  }),
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(compression());

app.use(httpLogger);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

app.use(cookieParser());

app.use(hpp());

app.use("/api", generalLimiter);

app.get("/", (_req, res) => {
  res.json({
    status: "running",
    service: "Poongodi Farm Products Backend API",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

const healthHandler = (_req: express.Request, res: express.Response) => {
  res.json({
    status: "healthy",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: "Poongodi Farm Products Backend API",
    environment: config.nodeEnv,
  });
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

app.use("/api/auth", authRoutes);

app.use("/api/admin/users", authLimiter, authMiddleware, getAllUsers);

app.use("/api/orders", orderRoutes);

app.use("/api/farm", farmRoutes);

app.use(notFoundHandler);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;

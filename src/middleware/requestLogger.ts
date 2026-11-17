import { pinoHttp } from 'pino-http';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existingId = req.headers['x-request-id'] as string;
    const reqId = existingId || randomUUID();
    res.setHeader('X-Request-Id', reqId);
    return reqId;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} -> ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`;
  },
  // Redact sensitive headers/fields from appearing in logs
  redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.newPassword'],
});

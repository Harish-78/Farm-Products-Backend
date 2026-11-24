import { pinoHttp } from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "../config/logger.js";

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const headerId = req.headers["x-request-id"];
    const existingId = Array.isArray(headerId) ? headerId[0] : headerId;
    const reqId = existingId || randomUUID();
    res.setHeader("X-Request-Id", reqId);
    return reqId;
  },
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} -> ${res.statusCode} (${req.id})`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`;
  },
});

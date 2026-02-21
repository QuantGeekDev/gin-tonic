import pino, { type Logger, type LoggerOptions } from "pino";

export interface JihnLoggerOptions {
  name: string;
  level?: string;
  base?: Record<string, unknown> | null;
}

const DEFAULT_REDACT_PATHS = [
  "authorization",
  "headers.authorization",
  "details.authorization",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "password",
  "body.token",
  "body.accessToken",
  "body.refreshToken",
  "body.clientSecret",
  "details.token",
  "details.accessToken",
  "details.refreshToken",
  "details.clientSecret",
] as const;

export function createJihnLogger(options: JihnLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    name: options.name,
    level: options.level ?? (process.env.JIHN_LOG_LEVEL?.trim() || "info"),
    base: options.base ?? null,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...DEFAULT_REDACT_PATHS],
      censor: "[REDACTED]",
    },
  };
  return pino(loggerOptions);
}

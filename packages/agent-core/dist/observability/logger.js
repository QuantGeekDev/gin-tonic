import pino, {} from "pino";
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
];
export function createJihnLogger(options) {
    const loggerOptions = {
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
//# sourceMappingURL=logger.js.map
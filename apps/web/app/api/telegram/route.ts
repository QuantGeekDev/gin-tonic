import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestLogger, generateRequestId } from "../logger";
import { enforceRequestPolicy, mapPolicyError, REQUEST_SCOPES } from "../shared-runtime";
import { apiError, apiSuccess } from "../response";

const TelegramDebugSnapshotSchema = z.object({
  generatedAt: z.string(),
  transportMode: z.enum(["polling", "webhook"]),
  outboundBackend: z.enum(["memory", "postgres"]),
  running: z.boolean(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  lastUpdateId: z.number().optional(),
  stats: z.object({
    received: z.number(),
    replied: z.number(),
    failed: z.number(),
    blocked: z.number(),
    retries: z.number(),
  }),
  outbound: z.object({
    queueDepth: z.number(),
    processing: z.number(),
    retryDepth: z.number(),
    deadLetterDepth: z.number(),
  }),
  recentEvents: z.array(
    z.object({
      timestamp: z.string(),
      level: z.enum(["info", "warn", "error"]),
      event: z.string(),
      updateId: z.number().optional(),
      chatId: z.number().optional(),
      detail: z.string().optional(),
    }),
  ),
});

function debugFilePath(): string {
  return process.env.JIHN_TELEGRAM_DEBUG_FILE ?? `${process.cwd()}/.jihn/telegram-debug.json`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/telegram:GET", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.AGENT_READ],
    });

    const path = debugFilePath();
    const raw = await readFile(path, "utf8");
    const parsed = TelegramDebugSnapshotSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      return apiError(
        requestId,
        {
          code: "INVALID_STATE",
          message: "telegram debug snapshot is invalid",
          details: parsed.error.issues,
        },
        500,
      );
    }

    logger.info({ path }, "request.complete");
    return apiSuccess(requestId, parsed.data);
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy) {
      const errorObject = policy.body.error as {
        code?: string;
        message?: string;
        details?: unknown;
      };
      return apiError(
        requestId,
        {
          code: errorObject.code ?? "POLICY_ERROR",
          message: errorObject.message ?? "request blocked by policy",
          ...(errorObject.details !== undefined ? { details: errorObject.details } : {}),
        },
        policy.statusCode,
      );
    }

    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    if (isMissing) {
      return apiError(
        requestId,
        {
          code: "NOT_FOUND",
          message: "telegram debug snapshot not found; start channel adapter first",
          details: { path: debugFilePath() },
        },
        404,
      );
    }

    logger.error({ error }, "request.error");
    return apiError(
      requestId,
      {
        code: "INTERNAL_ERROR",
        message: "request failed",
      },
      500,
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestLogger, generateRequestId } from "../logger";
import { apiError, apiSuccess } from "../response";
import { getGatewayClient } from "../gateway-client";
import { enforceRequestPolicy, mapPolicyError, REQUEST_SCOPES } from "../shared-runtime";

export const runtime = "nodejs";

const SettingsUpdateSchema = z
  .object({
    key: z.string().trim().min(1),
    value: z.string().trim().min(1),
  })
  .strict();

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/settings:GET", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.ADMIN],
    });
    const gateway = await getGatewayClient();
    const snapshot = await gateway.request("settings.snapshot", {});
    logger.info({}, "request.complete");
    return apiSuccess(requestId, snapshot);
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy !== null) {
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

    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error }, "request.error");
    return apiError(
      requestId,
      {
        code: "INTERNAL_ERROR",
        message,
      },
      500,
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/settings:POST", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.ADMIN],
    });
    const body = (await request.json()) as unknown;
    const parsed = SettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        requestId,
        {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "invalid request",
        },
        400,
      );
    }

    const gateway = await getGatewayClient();
    const result = await gateway.request("settings.update", parsed.data);
    const snapshot = await gateway.request("settings.snapshot", {});
    logger.info({ key: parsed.data.key }, "request.complete");
    return apiSuccess(requestId, { update: result, snapshot });
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy !== null) {
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

    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error }, "request.error");
    return apiError(
      requestId,
      {
        code: "INTERNAL_ERROR",
        message,
      },
      500,
    );
  }
}


import { NextResponse } from "next/server";
import { createRequestLogger, generateRequestId } from "../logger";
import {
  enforceRequestPolicy,
  mapPolicyError,
  REQUEST_SCOPES,
} from "../shared-runtime";
import { apiError, apiSuccess } from "../response";
import { getGatewayClient } from "../gateway-client";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/plugins:GET", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.AGENT_READ],
    });

    const gateway = await getGatewayClient();
    const snapshot = await gateway.request("plugins.snapshot", {});
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

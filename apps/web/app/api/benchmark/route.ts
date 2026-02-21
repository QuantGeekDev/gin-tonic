import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestLogger, generateRequestId } from "../logger";
import { apiError, apiSuccess } from "../response";
import { getGatewayClient } from "../gateway-client";
import { enforceRequestPolicy, mapPolicyError, REQUEST_SCOPES } from "../shared-runtime";

export const runtime = "nodejs";

const BenchmarkRunSchema = z
  .object({
    scenario: z.string().trim().min(1),
    samples: z.number().int().min(1).max(10_000).optional(),
    warmup: z.number().int().min(0).max(5_000).optional(),
    concurrency: z.number().int().min(1).max(256).optional(),
    label: z.string().trim().min(1).max(128).optional(),
    payload: z.unknown().optional(),
  })
  .strict();

function policyErrorResponse(requestId: string, policy: { statusCode: number; body: Record<string, unknown> }) {
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

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/benchmark:GET", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.ADMIN],
    });
    const gateway = await getGatewayClient();
    const snapshot = await gateway.request("benchmark.snapshot", {});
    logger.info({}, "request.complete");
    return apiSuccess(requestId, snapshot);
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy !== null) {
      return policyErrorResponse(requestId, policy);
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
  const logger = createRequestLogger("/api/benchmark:POST", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.ADMIN],
    });
    const body = (await request.json()) as unknown;
    const parsed = BenchmarkRunSchema.safeParse(body);
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
    const result = await gateway.request("benchmark.run", parsed.data);
    const snapshot = await gateway.request("benchmark.snapshot", {});
    logger.info({ scenario: parsed.data.scenario }, "request.complete");
    return apiSuccess(requestId, { result, snapshot });
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy !== null) {
      return policyErrorResponse(requestId, policy);
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

export async function DELETE(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/benchmark:DELETE", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.ADMIN],
    });
    const gateway = await getGatewayClient();
    const cleared = await gateway.request("benchmark.clear", {});
    const snapshot = await gateway.request("benchmark.snapshot", {});
    logger.info({}, "request.complete");
    return apiSuccess(requestId, { cleared, snapshot });
  } catch (error) {
    const policy = mapPolicyError(error);
    if (policy !== null) {
      return policyErrorResponse(requestId, policy);
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

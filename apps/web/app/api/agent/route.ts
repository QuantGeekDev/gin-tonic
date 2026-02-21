import { NextResponse } from "next/server";
import type { AgentTurnRequest } from "./types";
import {
  parseAgentTurnRequestBody,
  RequestValidationError,
} from "./validation";
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
  const logger = createRequestLogger("/api/agent:GET", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.AGENT_READ],
    });

    const gateway = await getGatewayClient();
    const meta = await gateway.request<{
      provider: string;
      model: string;
      tools: Array<{ name: string; description: string }>;
    }>("runtime.meta", {});

    logger.info({ toolCount: meta.tools.length }, "request.complete");
    return apiSuccess(requestId, meta);
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

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/agent:POST", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.AGENT_WRITE],
    });

    const typedBody: AgentTurnRequest = parseAgentTurnRequestBody(
      (await request.json()) as unknown,
    );

    const gateway = await getGatewayClient();
    const headerIdempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    const effectiveIdempotencyKey =
      headerIdempotencyKey && headerIdempotencyKey.length > 0
        ? headerIdempotencyKey
        : typedBody.idempotencyKey;

    const result = await gateway.request<{
      text: string;
      messages: unknown[];
      usage: {
        estimatedInputTokens: number;
        inputTokens: number;
        outputTokens: number;
      };
      routing: {
        agentId: string;
        scope: string;
        channelId: string;
        peerId: string;
        sessionKey: string;
      };
      persistenceMode: "append" | "save";
      compaction?: unknown;
      idempotencyHit?: boolean;
    }>(
      "agent.run",
      {
        text: typedBody.text,
        routing: {
          ...(typedBody.agentId ? { agentId: typedBody.agentId } : {}),
          ...(typedBody.scope ? { scope: typedBody.scope } : {}),
          ...(typedBody.channelId ? { channelId: typedBody.channelId } : {}),
          peerId: typedBody.peerId,
        },
      },
      effectiveIdempotencyKey !== undefined
        ? { idempotencyKey: effectiveIdempotencyKey }
        : {},
    );

    return apiSuccess(requestId, {
      text: result.text,
      messages: result.messages,
      usage: result.usage,
      toolEvents: [],
      provider: "gateway",
      model: "gateway",
      session: result.routing,
      persistenceMode: result.persistenceMode,
      compaction: result.compaction ?? null,
      idempotencyHit: result.idempotencyHit ?? false,
    });
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

    if (error instanceof RequestValidationError) {
      return apiError(
        requestId,
        {
          code: "VALIDATION_ERROR",
          message: error.message,
        },
        error.statusCode,
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

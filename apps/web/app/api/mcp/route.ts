import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforceRequestPolicy,
  mapPolicyError,
  REQUEST_SCOPES,
} from "../shared-runtime";
import { createRequestLogger, generateRequestId } from "../logger";
import { apiError, apiSuccess } from "../response";
import { getGatewayClient } from "../gateway-client";

export const runtime = "nodejs";

const mcpActionSchema = z
  .object({
    action: z
      .enum(["snapshot", "refresh", "add_server", "remove_server", "begin_oauth"])
      .default("snapshot"),
    id: z.string().trim().min(1).optional(),
    url: z.string().trim().url().optional(),
    name: z.string().trim().min(1).optional(),
    authMode: z.enum(["none", "bearer", "oauth2"]).optional(),
    bearerToken: z.string().optional(),
    scope: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
  })
  .strict();

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/mcp:GET", requestId);
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.MCP_READ],
    });

    const gateway = await getGatewayClient();
    const snapshot = await gateway.request("mcp.snapshot", { refresh: forceRefresh });
    logger.info({ forceRefresh }, "request.complete");
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
    return apiError(requestId, { code: "INTERNAL_ERROR", message }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/mcp:POST", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.MCP_WRITE],
    });

    const body = (await request.json()) as unknown;
    const parsed = mcpActionSchema.safeParse(body);
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

    const payload = parsed.data;
    const gateway = await getGatewayClient();

    if (payload.action === "refresh") {
      const snapshot = await gateway.request("mcp.snapshot", { refresh: true });
      return apiSuccess(requestId, { refreshed: true, snapshot });
    }

    if (payload.action === "add_server") {
      const snapshot = await gateway.request("mcp.add_server", {
        id: payload.id,
        url: payload.url,
        name: payload.name,
        authMode: payload.authMode,
        bearerToken: payload.bearerToken,
        scope: payload.scope,
        clientId: payload.clientId,
        clientSecret: payload.clientSecret,
      });
      return apiSuccess(requestId, { action: payload.action, snapshot });
    }

    if (payload.action === "remove_server") {
      const snapshot = await gateway.request("mcp.remove_server", { id: payload.id });
      return apiSuccess(requestId, { action: payload.action, snapshot });
    }

    if (payload.action === "begin_oauth") {
      const result = await gateway.request("mcp.begin_oauth", { id: payload.id });
      const snapshot = await gateway.request("mcp.snapshot", {});
      return apiSuccess(requestId, {
        action: payload.action,
        ...(typeof (result as { authorizationUrl?: string }).authorizationUrl === "string"
          ? { authorizationUrl: (result as { authorizationUrl: string }).authorizationUrl }
          : {}),
        snapshot,
      });
    }

    const snapshot = await gateway.request("mcp.snapshot", {});
    logger.info({ action: payload.action }, "request.complete");
    return apiSuccess(requestId, { refreshed: false, snapshot });
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
    return apiError(requestId, { code: "INTERNAL_ERROR", message }, 500);
  }
}

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

const memoryQuerySchema = z.object({
  query: z.string().trim().default(""),
  namespace: z.string().trim().default(""),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const memoryWriteSchema = z
  .object({
    action: z.literal("save").default("save"),
    text: z.string().trim().min(1, "text must be a non-empty string"),
    namespace: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const memoryReindexSchema = z
  .object({
    action: z.literal("reindex_embeddings"),
    limit: z.coerce.number().int().positive().max(10_000).optional(),
  })
  .strict();

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/memory:GET", requestId);

  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.MEMORY_READ],
    });

    const url = new URL(request.url);
    const parsed = memoryQuerySchema.safeParse({
      query: url.searchParams.get("query") ?? "",
      namespace: url.searchParams.get("namespace") ?? "",
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return apiError(
        requestId,
        {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "invalid query",
        },
        400,
      );
    }

    const { query, namespace, limit } = parsed.data;
    if (query.length === 0) {
      return apiSuccess(requestId, { results: [] });
    }

    const gateway = await getGatewayClient();
    const results = await gateway.request("memory.search", {
      query,
      ...(namespace.length > 0 ? { namespace } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    logger.info({ namespace }, "request.complete");
    return apiSuccess(requestId, { results });
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
  const logger = createRequestLogger("/api/memory:POST", requestId);

  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.MEMORY_WRITE],
    });

    const body = (await request.json()) as unknown;
    const gateway = await getGatewayClient();

    const parsedReindex = memoryReindexSchema.safeParse(body);
    if (parsedReindex.success) {
      const result = await gateway.request("memory.reindex_embeddings", {
        limit: parsedReindex.data.limit ?? 200,
      });
      return apiSuccess(requestId, result);
    }

    const parsedWrite = memoryWriteSchema.safeParse(body);
    if (!parsedWrite.success) {
      return apiError(
        requestId,
        {
          code: "VALIDATION_ERROR",
          message: parsedWrite.error.issues[0]?.message ?? "invalid request body",
        },
        400,
      );
    }

    const saved = await gateway.request("memory.save", {
      text: parsedWrite.data.text,
      ...(parsedWrite.data.namespace !== undefined
        ? { namespace: parsedWrite.data.namespace }
        : {}),
      ...(parsedWrite.data.tags !== undefined ? { tags: parsedWrite.data.tags } : {}),
    });

    logger.info({}, "request.complete");
    return apiSuccess(requestId, { saved });
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

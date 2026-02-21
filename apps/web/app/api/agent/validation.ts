import { SESSION_SCOPES, type SessionScope } from "@jihn/agent-core";
import { z } from "zod";
import type { AgentTurnRequest } from "./types";

export class RequestValidationError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.statusCode = statusCode;
  }
}

function fail(message: string): never {
  throw new RequestValidationError(message);
}

const agentTurnRequestSchema = z
  .object({
    text: z.string().trim().min(1, "text must be a non-empty string"),
    peerId: z.string().trim().min(1, "peerId must be a non-empty string"),
    scope: z
      .string()
      .refine(
        (value): value is SessionScope =>
          SESSION_SCOPES.includes(value as SessionScope),
        `scope must be one of: ${SESSION_SCOPES.join(", ")}`,
      )
      .optional(),
    channelId: z.string().optional(),
    agentId: z.string().optional(),
    maxTurns: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    debug: z
      .object({
        simulateCompaction: z.boolean().optional(),
        compareChannels: z.boolean().optional(),
      })
      .optional(),
    idempotencyKey: z.string().optional(),
  })
  .strict();

export function parseAgentTurnRequestBody(rawBody: unknown): AgentTurnRequest {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    fail("request body must be a JSON object");
  }

  const body = rawBody as Record<string, unknown>;

  if ("input" in body || "messages" in body) {
    fail("legacy fields are not supported; use only text + peerId + optional routing fields");
  }

  const parsed = agentTurnRequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    fail(firstIssue?.message ?? "invalid request body");
  }

  const value = parsed.data;
  return {
    text: value.text,
    peerId: value.peerId,
    ...(value.scope !== undefined ? { scope: value.scope } : {}),
    ...(value.channelId !== undefined ? { channelId: value.channelId } : {}),
    ...(value.agentId !== undefined ? { agentId: value.agentId } : {}),
    ...(value.maxTurns !== undefined ? { maxTurns: value.maxTurns } : {}),
    ...(value.maxTokens !== undefined ? { maxTokens: value.maxTokens } : {}),
    ...(value.debug !== undefined
      ? {
          debug: {
            simulateCompaction: value.debug.simulateCompaction === true,
            compareChannels: value.debug.compareChannels !== false,
          },
        }
      : {}),
    ...(value.idempotencyKey !== undefined
      ? { idempotencyKey: value.idempotencyKey }
      : {}),
  };
}

import { z } from "zod";
import type { Message } from "@jihn/agent-core";
import {
  ApiErrorEnvelopeSchema,
  createApiSuccessEnvelopeSchema,
} from "../contracts/api";

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 1024;
export const PEER_ID_STORAGE_KEY = "jihn.peerId";

export class ApiEnvelopeError extends Error {
  public readonly code: string;
  public readonly requestId: string;
  public readonly details: unknown;

  public constructor(params: {
    message: string;
    code: string;
    requestId: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ApiEnvelopeError";
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export async function readApiData<T>(
  response: Response,
  dataSchema: z.ZodType<T>,
): Promise<T> {
  const payload = (await response.json()) as unknown;

  const parsedError = ApiErrorEnvelopeSchema.safeParse(payload);
  if (parsedError.success) {
    throw new ApiEnvelopeError({
      message: parsedError.data.error.message,
      code: parsedError.data.error.code,
      requestId: parsedError.data.requestId,
      ...(parsedError.data.error.details !== undefined
        ? { details: parsedError.data.error.details }
        : {}),
    });
  }

  const successSchema = createApiSuccessEnvelopeSchema(dataSchema);
  const parsedSuccess = successSchema.safeParse(payload);
  if (!parsedSuccess.success) {
    throw new Error("Invalid API response envelope.");
  }
  return parsedSuccess.data.data;
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiEnvelopeError) {
    return `${error.message} (requestId: ${error.requestId})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now()}`;
}

export function renderMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "tool_use") {
        return `🔧 ${block.name} ${JSON.stringify(block.input)}`;
      }
      if (block.type === "tool_result") {
        return `→ ${block.content}`;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

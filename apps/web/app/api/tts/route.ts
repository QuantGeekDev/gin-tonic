import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTtsProviderFromEnv,
  resolveChannelTtsPolicyFromEnv,
} from "@jihn/agent-core";
import { createRequestLogger, generateRequestId } from "../logger";
import { apiError } from "../response";
import { enforceRequestPolicy, mapPolicyError, REQUEST_SCOPES } from "../shared-runtime";

export const runtime = "nodejs";

const webTtsPolicy = resolveChannelTtsPolicyFromEnv({
  channelId: "web",
  env: process.env,
});

const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(webTtsPolicy.maxChars),
  voiceId: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(120).optional(),
  outputFormat: z.string().trim().min(1).max(64).optional(),
});

const ttsProvider = createTtsProviderFromEnv(process.env);

export async function POST(request: Request): Promise<Response> {
  const requestId = generateRequestId();
  const logger = createRequestLogger("/api/tts:POST", requestId);
  try {
    enforceRequestPolicy({
      request,
      requiredScopes: [REQUEST_SCOPES.AGENT_WRITE],
    });

    if (ttsProvider === null || webTtsPolicy.mode === "off") {
      return apiError(
        requestId,
        {
          code: "TTS_DISABLED",
          message:
            webTtsPolicy.disabledReason ??
            "TTS provider is disabled. Set JIHN_TTS_PROVIDER=elevenlabs and ELEVENLABS_API_KEY.",
        },
        503,
      );
    }

    const body = TtsRequestSchema.parse((await request.json()) as unknown);
    const result = await ttsProvider.synthesize({
      text: body.text,
      ...(body.voiceId !== undefined
        ? { voiceId: body.voiceId }
        : webTtsPolicy.voiceId !== undefined
          ? { voiceId: webTtsPolicy.voiceId }
          : {}),
      ...(body.modelId !== undefined
        ? { modelId: body.modelId }
        : webTtsPolicy.modelId !== undefined
          ? { modelId: webTtsPolicy.modelId }
          : {}),
      ...(body.outputFormat !== undefined
        ? { outputFormat: body.outputFormat }
        : { outputFormat: webTtsPolicy.outputFormat }),
    });

    logger.info({ bytes: result.audio.byteLength, format: result.outputFormat }, "request.complete");
    const bytes = new Uint8Array(result.audio.byteLength);
    bytes.set(result.audio);
    const audioBody = new Blob([bytes], { type: result.contentType });
    return new NextResponse(audioBody, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "cache-control": "no-store",
        "x-request-id": requestId,
        "x-jihn-tts-format": result.outputFormat,
      },
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

    if (error instanceof z.ZodError) {
      return apiError(
        requestId,
        {
          code: "VALIDATION_ERROR",
          message: "Invalid TTS request payload.",
          details: error.flatten(),
        },
        400,
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

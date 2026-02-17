import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import {
  DEFAULT_ANTHROPIC_MODEL,
  type AnthropicModel,
} from "../providers/anthropic/config.js";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface AnthropicTextRequest {
  prompt: string;
  model?: AnthropicModel;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface AnthropicVisionRequest extends AnthropicTextRequest {
  imagePath: string;
  imageMediaType: ImageMediaType;
}

export function createAnthropicClient(apiKey = process.env.ANTHROPIC_API_KEY): Anthropic {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required to call Anthropic.");
  }

  return new Anthropic({ apiKey });
}

function extractTextContent(message: Anthropic.Message): string {
  const blocks = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0);

  return blocks.join("\n").trim();
}

export async function sendTextPrompt(
  client: Anthropic,
  request: AnthropicTextRequest,
): Promise<string> {
  const params: MessageCreateParamsNonStreaming = {
    model: request.model ?? DEFAULT_ANTHROPIC_MODEL,
    max_tokens: request.maxTokens ?? 1024,
    messages: [{ role: "user", content: request.prompt }],
    ...(request.systemPrompt
      ? {
          system: request.systemPrompt,
        }
      : {}),
  };
  const response = await client.messages.create(params);

  return extractTextContent(response);
}

export async function sendVisionPromptFromFile(
  client: Anthropic,
  request: AnthropicVisionRequest,
): Promise<string> {
  const imageData = await readFile(request.imagePath, { encoding: "base64" });
  const params: MessageCreateParamsNonStreaming = {
    model: request.model ?? DEFAULT_ANTHROPIC_MODEL,
    max_tokens: request.maxTokens ?? 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: request.imageMediaType,
              data: imageData,
            },
          },
          {
            type: "text",
            text: request.prompt,
          },
        ],
      },
    ],
    ...(request.systemPrompt
      ? {
          system: request.systemPrompt,
        }
      : {}),
  };
  const response = await client.messages.create(params);

  return extractTextContent(response);
}

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageCountTokensParams,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { ToolDefinition } from "../../tools.js";
import type { ContentBlock, Message } from "../../types/message.js";
import {
  LLM_PROVIDER_IDS,
  LLM_STOP_REASONS,
  type LlmCountTokensParams,
  type LlmCreateTurnParams,
  type LlmCreateTurnResult,
  type LlmProviderClient,
} from "../types.js";

export const ANTHROPIC_MODEL_CATALOG = [
  "claude-sonnet-4-6",
  "claude-3-5-haiku-latest",
  "claude-3-5-haiku-20241022",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-4-sonnet-20250514",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-0",
] as const;

export type AnthropicModel = (typeof ANTHROPIC_MODEL_CATALOG)[number];

export const DEFAULT_ANTHROPIC_MODEL: AnthropicModel =
  "claude-sonnet-4-5-20250929";

const ANTHROPIC_MODEL_SET = new Set<string>(ANTHROPIC_MODEL_CATALOG);

function toToolParam(definition: ToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    input_schema: (definition.input_schema ??
      definition.inputSchema) as Tool["input_schema"],
  };
}

function toContentBlocks(
  content: Message["content"],
): ContentBlockParam[] | string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => {
    if (block.type === "tool_result") {
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
      };
    }
    return block as ContentBlockParam;
  });
}

function toMessageParam(message: Message): MessageParam {
  return {
    role: message.role,
    content: toContentBlocks(message.content),
  };
}

function serializeBlocks(content: Anthropic.ContentBlock[]): ContentBlock[] {
  return JSON.parse(JSON.stringify(content)) as ContentBlock[];
}

function normalizeStopReason(value: string | null | undefined): LlmCreateTurnResult["stopReason"] {
  if (value === LLM_STOP_REASONS.END_TURN) {
    return LLM_STOP_REASONS.END_TURN;
  }
  if (value === LLM_STOP_REASONS.TOOL_USE) {
    return LLM_STOP_REASONS.TOOL_USE;
  }
  return LLM_STOP_REASONS.OTHER;
}

async function countAnthropicTokens(
  client: Anthropic,
  params: LlmCountTokensParams,
): Promise<number> {
  if (typeof client.messages.countTokens !== "function") {
    throw new Error("Anthropic client does not support messages.countTokens");
  }

  const tokenParams: MessageCountTokensParams = {
    model: params.model,
    system: params.systemPrompt,
    tools: params.tools.map(toToolParam),
    messages: params.messages.map(toMessageParam),
  };

  const tokenResult = await client.messages.countTokens(tokenParams);
  return tokenResult.input_tokens;
}

async function createAnthropicTurn(
  client: Anthropic,
  params: LlmCreateTurnParams,
): Promise<LlmCreateTurnResult> {
  const response = await client.messages.create({
    model: params.model,
    system: params.systemPrompt,
    tools: params.tools.map(toToolParam),
    max_tokens: params.maxTokens,
    messages: params.messages.map(toMessageParam),
  });

  return {
    content: serializeBlocks(response.content),
    stopReason: normalizeStopReason(response.stop_reason),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export function resolveAnthropicModel(rawModel: string | undefined): AnthropicModel {
  if (rawModel === undefined || rawModel.trim().length === 0) {
    return DEFAULT_ANTHROPIC_MODEL;
  }

  if (ANTHROPIC_MODEL_SET.has(rawModel)) {
    return rawModel as AnthropicModel;
  }

  throw new Error(
    `Unsupported ANTHROPIC_MODEL '${rawModel}'. Allowed: ${ANTHROPIC_MODEL_CATALOG.join(", ")}`,
  );
}

export function createAnthropicClient(
  apiKey = process.env.ANTHROPIC_API_KEY,
): Anthropic {
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required to call Anthropic.");
  }

  return new Anthropic({ apiKey });
}

export function createAnthropicProviderClient(
  apiKey = process.env.ANTHROPIC_API_KEY,
): LlmProviderClient {
  const client = createAnthropicClient(apiKey);
  return {
    providerId: LLM_PROVIDER_IDS.ANTHROPIC,
    async createTurn(params) {
      return createAnthropicTurn(client, params);
    },
    async countTokens(params) {
      return countAnthropicTokens(client, params);
    },
  };
}

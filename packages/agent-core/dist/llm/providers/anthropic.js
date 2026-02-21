import Anthropic from "@anthropic-ai/sdk";
import { LLM_PROVIDER_IDS, LLM_STOP_REASONS, } from "../types.js";
export const ANTHROPIC_MODEL_CATALOG = [
    "claude-sonnet-4-6",
    "claude-3-5-haiku-latest",
    "claude-3-5-haiku-20241022",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-5",
    "claude-4-sonnet-20250514",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-0",
];
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const ANTHROPIC_MODEL_SET = new Set(ANTHROPIC_MODEL_CATALOG);
function toToolParam(definition) {
    return {
        name: definition.name,
        description: definition.description,
        input_schema: (definition.input_schema ??
            definition.inputSchema),
    };
}
function toContentBlocks(content) {
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
        return block;
    });
}
function toMessageParam(message) {
    return {
        role: message.role,
        content: toContentBlocks(message.content),
    };
}
function serializeBlocks(content) {
    return JSON.parse(JSON.stringify(content));
}
function normalizeStopReason(value) {
    if (value === LLM_STOP_REASONS.END_TURN) {
        return LLM_STOP_REASONS.END_TURN;
    }
    if (value === LLM_STOP_REASONS.TOOL_USE) {
        return LLM_STOP_REASONS.TOOL_USE;
    }
    return LLM_STOP_REASONS.OTHER;
}
async function countAnthropicTokens(client, params) {
    if (typeof client.messages.countTokens !== "function") {
        throw new Error("Anthropic client does not support messages.countTokens");
    }
    const tokenParams = {
        model: params.model,
        system: params.systemPrompt,
        tools: params.tools.map(toToolParam),
        messages: params.messages.map(toMessageParam),
    };
    const tokenResult = await client.messages.countTokens(tokenParams);
    return tokenResult.input_tokens;
}
async function createAnthropicTurn(client, params) {
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
export function resolveAnthropicModel(rawModel) {
    if (rawModel === undefined || rawModel.trim().length === 0) {
        return DEFAULT_ANTHROPIC_MODEL;
    }
    if (ANTHROPIC_MODEL_SET.has(rawModel)) {
        return rawModel;
    }
    throw new Error(`Unsupported ANTHROPIC_MODEL '${rawModel}'. Allowed: ${ANTHROPIC_MODEL_CATALOG.join(", ")}`);
}
export function createAnthropicClient(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (apiKey === undefined || apiKey.trim().length === 0) {
        throw new Error("ANTHROPIC_API_KEY is required to call Anthropic.");
    }
    return new Anthropic({ apiKey });
}
export function createAnthropicProviderClient(apiKey = process.env.ANTHROPIC_API_KEY) {
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
//# sourceMappingURL=anthropic.js.map
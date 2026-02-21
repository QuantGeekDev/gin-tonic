import OpenAI from "openai";
import { LLM_PROVIDER_IDS, LLM_STOP_REASONS, } from "../types.js";
export const OPENAI_MODEL_CATALOG = [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
];
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";
function toOpenAITools(tools) {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: (tool.input_schema ?? tool.inputSchema),
        },
    }));
}
function readTextBlocks(content) {
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
}
function readToolUses(content) {
    if (typeof content === "string") {
        return [];
    }
    return content.filter((block) => block.type === "tool_use");
}
function readToolResults(content) {
    if (typeof content === "string") {
        return [];
    }
    return content.filter((block) => block.type === "tool_result");
}
function toOpenAIMessages(messages) {
    const output = [];
    for (const message of messages) {
        const text = readTextBlocks(message.content);
        if (message.role === "assistant") {
            const toolUses = readToolUses(message.content);
            if (toolUses.length > 0) {
                const assistantMessage = {
                    role: "assistant",
                    ...(text.length > 0 ? { content: text } : { content: null }),
                    tool_calls: toolUses.map((toolUse) => ({
                        id: toolUse.id,
                        type: "function",
                        function: {
                            name: toolUse.name,
                            arguments: JSON.stringify(toolUse.input),
                        },
                    })),
                };
                output.push(assistantMessage);
            }
            else {
                output.push({
                    role: "assistant",
                    content: text,
                });
            }
            continue;
        }
        const toolResults = readToolResults(message.content);
        if (toolResults.length > 0) {
            for (const result of toolResults) {
                const toolMessage = {
                    role: "tool",
                    tool_call_id: result.tool_use_id,
                    content: result.content,
                };
                output.push(toolMessage);
            }
            continue;
        }
        const userMessage = {
            role: "user",
            content: text,
        };
        output.push(userMessage);
    }
    return output;
}
function parseToolInput(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    }
    catch {
        return {};
    }
}
function toContentBlocksFromOpenAI(params) {
    const blocks = [];
    if (typeof params.content === "string" && params.content.trim().length > 0) {
        blocks.push({
            type: "text",
            text: params.content,
        });
    }
    for (const toolCall of params.toolCalls) {
        if (toolCall.type === "function") {
            blocks.push({
                type: "tool_use",
                id: toolCall.id,
                name: toolCall.function.name,
                input: parseToolInput(toolCall.function.arguments),
            });
            continue;
        }
        if (toolCall.type === "custom") {
            blocks.push({
                type: "tool_use",
                id: toolCall.id,
                name: toolCall.custom.name,
                input: parseToolInput(toolCall.custom.input),
            });
        }
    }
    if (blocks.length === 0) {
        return "";
    }
    return blocks;
}
function toStopReason(finishReason) {
    if (finishReason === "tool_calls") {
        return LLM_STOP_REASONS.TOOL_USE;
    }
    if (finishReason === "stop") {
        return LLM_STOP_REASONS.END_TURN;
    }
    return LLM_STOP_REASONS.OTHER;
}
export function resolveOpenAIModel(rawModel) {
    if (rawModel === undefined || rawModel.trim().length === 0) {
        return DEFAULT_OPENAI_MODEL;
    }
    return rawModel.trim();
}
export function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY) {
    if (apiKey === undefined || apiKey.trim().length === 0) {
        throw new Error("OPENAI_API_KEY is required to call OpenAI.");
    }
    return new OpenAI({ apiKey });
}
async function createOpenAITurn(client, params) {
    const response = await client.chat.completions.create({
        model: params.model,
        messages: [
            {
                role: "system",
                content: params.systemPrompt,
            },
            ...toOpenAIMessages(params.messages),
        ],
        tools: toOpenAITools(params.tools),
        temperature: 0,
        max_tokens: params.maxTokens,
    });
    const firstChoice = response.choices[0];
    const content = firstChoice?.message?.content ?? null;
    const toolCalls = firstChoice?.message?.tool_calls ?? [];
    return {
        content: toContentBlocksFromOpenAI({
            content,
            toolCalls,
        }),
        stopReason: toStopReason(firstChoice?.finish_reason),
        usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
        },
    };
}
export function createOpenAIProviderClient(apiKey = process.env.OPENAI_API_KEY) {
    const client = createOpenAIClient(apiKey);
    return {
        providerId: LLM_PROVIDER_IDS.OPENAI,
        async createTurn(params) {
            return createOpenAITurn(client, params);
        },
    };
}
//# sourceMappingURL=openai.js.map
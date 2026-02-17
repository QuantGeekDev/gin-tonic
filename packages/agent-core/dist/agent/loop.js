import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_MAX_TURNS, } from "../config/agent.js";
import {} from "../types.js";
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
function readTextBlocks(content) {
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((block) => block.type === "text" &&
        typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
}
function toRecordInput(input) {
    if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        return input;
    }
    return {};
}
export async function runAgentTurn(params) {
    const model = params.model ?? DEFAULT_ANTHROPIC_MODEL;
    const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const messages = [...params.messages];
    const tools = params.tools.map(toToolParam);
    let estimatedInputTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (let turn = 0; turn < maxTurns; turn += 1) {
        if (typeof params.client.messages.countTokens === "function") {
            const tokenCountParams = {
                model,
                system: params.systemPrompt,
                tools,
                messages: messages.map(toMessageParam),
            };
            const tokenEstimate = await params.client.messages.countTokens(tokenCountParams);
            estimatedInputTokens += tokenEstimate.input_tokens;
        }
        const response = await params.client.messages.create({
            model,
            system: params.systemPrompt,
            tools,
            max_tokens: maxTokens,
            messages: messages.map(toMessageParam),
        });
        inputTokens += response.usage?.input_tokens ?? 0;
        outputTokens += response.usage?.output_tokens ?? 0;
        const serializedBlocks = serializeBlocks(response.content);
        messages.push({
            role: "assistant",
            content: serializedBlocks,
        });
        if (response.stop_reason === "end_turn") {
            return {
                text: readTextBlocks(serializedBlocks),
                messages,
                usage: {
                    estimatedInputTokens,
                    inputTokens,
                    outputTokens,
                },
            };
        }
        if (response.stop_reason !== "tool_use") {
            return {
                text: readTextBlocks(serializedBlocks),
                messages,
                usage: {
                    estimatedInputTokens,
                    inputTokens,
                    outputTokens,
                },
            };
        }
        const toolUseBlocks = serializedBlocks.filter((block) => block.type === "tool_use");
        const toolResults = [];
        for (const block of toolUseBlocks) {
            const result = await params.executeTool(block.name, toRecordInput(block.input));
            toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
            });
        }
        messages.push({
            role: "user",
            content: toolResults,
        });
    }
    messages.push({
        role: "assistant",
        content: [{ type: "text", text: "(max tool turns reached)" }],
    });
    return {
        text: "(max tool turns reached)",
        messages,
        usage: {
            estimatedInputTokens,
            inputTokens,
            outputTokens,
        },
    };
}
//# sourceMappingURL=loop.js.map
import { DEFAULT_MAX_TOKENS, DEFAULT_MAX_TURNS, } from "../config/agent.js";
import { DEFAULT_LLM_MODEL } from "../llm/registry.js";
import { LLM_STOP_REASONS } from "../llm/types.js";
import {} from "../types.js";
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
    const model = params.model ?? DEFAULT_LLM_MODEL;
    const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const messages = [...params.messages];
    let estimatedInputTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (let turn = 0; turn < maxTurns; turn += 1) {
        if (typeof params.client.countTokens === "function") {
            const tokenEstimate = await params.client.countTokens({
                model,
                systemPrompt: params.systemPrompt,
                tools: params.tools,
                messages,
            });
            estimatedInputTokens += tokenEstimate;
        }
        const response = await params.client.createTurn({
            model,
            systemPrompt: params.systemPrompt,
            tools: params.tools,
            maxTokens,
            messages,
        });
        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;
        messages.push({
            role: "assistant",
            content: response.content,
        });
        if (response.stopReason === LLM_STOP_REASONS.END_TURN) {
            return {
                text: readTextBlocks(response.content),
                messages,
                usage: {
                    estimatedInputTokens,
                    inputTokens,
                    outputTokens,
                },
            };
        }
        if (response.stopReason !== LLM_STOP_REASONS.TOOL_USE) {
            return {
                text: readTextBlocks(response.content),
                messages,
                usage: {
                    estimatedInputTokens,
                    inputTokens,
                    outputTokens,
                },
            };
        }
        const toolUseBlocks = Array.isArray(response.content)
            ? response.content.filter((block) => block.type === "tool_use")
            : [];
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
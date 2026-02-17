import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "./tools.js";
import type { Message } from "./types/message.js";
export type { ContentBlock, TextBlock, ToolResultBlock, ToolUseBlock, } from "./types/message.js";
export type { Message } from "./types/message.js";
export type { SessionKeyInput, SessionScope } from "./types/session.js";
export { SESSION_SCOPES } from "./types/session.js";
export interface RunAgentTurnParams {
    client: Anthropic;
    messages: Message[];
    systemPrompt: string;
    tools: ToolDefinition[];
    executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
}
export interface RunAgentTurnResult {
    text: string;
    messages: Message[];
    usage: {
        estimatedInputTokens: number;
        inputTokens: number;
        outputTokens: number;
    };
}
//# sourceMappingURL=types.d.ts.map
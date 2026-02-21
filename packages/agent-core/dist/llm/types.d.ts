import type { Message } from "../types/message.js";
import type { ToolDefinition } from "../tools.js";
export declare const LLM_PROVIDER_IDS: {
    readonly ANTHROPIC: "anthropic";
    readonly OPENAI: "openai";
};
export type BuiltInLlmProviderId = (typeof LLM_PROVIDER_IDS)[keyof typeof LLM_PROVIDER_IDS];
export type LlmProviderId = BuiltInLlmProviderId | (string & {});
export declare const LLM_STOP_REASONS: {
    readonly END_TURN: "end_turn";
    readonly TOOL_USE: "tool_use";
    readonly OTHER: "other";
};
export type LlmStopReason = (typeof LLM_STOP_REASONS)[keyof typeof LLM_STOP_REASONS];
export interface LlmUsage {
    inputTokens: number;
    outputTokens: number;
}
export interface LlmCreateTurnParams {
    model: string;
    systemPrompt: string;
    tools: ToolDefinition[];
    messages: Message[];
    maxTokens: number;
}
export interface LlmCreateTurnResult {
    content: Message["content"];
    stopReason: LlmStopReason;
    usage: LlmUsage;
}
export interface LlmCountTokensParams {
    model: string;
    systemPrompt: string;
    tools: ToolDefinition[];
    messages: Message[];
}
export interface LlmProviderClient {
    readonly providerId: LlmProviderId;
    createTurn(params: LlmCreateTurnParams): Promise<LlmCreateTurnResult>;
    countTokens?(params: LlmCountTokensParams): Promise<number>;
}
export interface ResolveLlmModelInput {
    providerId: LlmProviderId;
    rawModel?: string;
}
export interface ResolvedLlmModel {
    providerId: LlmProviderId;
    model: string;
}
//# sourceMappingURL=types.d.ts.map
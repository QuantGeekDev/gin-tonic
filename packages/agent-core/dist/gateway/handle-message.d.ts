import type Anthropic from "@anthropic-ai/sdk";
import { SessionStore } from "../sessions/store.js";
import type { ToolDefinition } from "../tools.js";
import type { Message } from "../types/message.js";
import type { SessionScope } from "../types/session.js";
import type { RunAgentTurnParams, RunAgentTurnResult } from "../types.js";
type TurnRunner = (params: RunAgentTurnParams) => Promise<RunAgentTurnResult>;
export interface HandleMessageRoutingInput {
    agentId?: string;
    scope?: SessionScope;
    channelId?: string;
    peerId?: string;
}
export interface HandleMessageResolvedRouting {
    agentId: string;
    scope: SessionScope;
    channelId: string;
    peerId: string;
    sessionKey: string;
}
export interface HandleMessageParams {
    client: Anthropic;
    text: string;
    systemPrompt: string;
    tools: ToolDefinition[];
    executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
    routing?: HandleMessageRoutingInput;
    sessionStore?: SessionStore;
    runTurn?: TurnRunner;
}
export interface HandleMessageResult {
    text: string;
    messages: Message[];
    usage: RunAgentTurnResult["usage"];
    routing: HandleMessageResolvedRouting;
    persistenceMode: "append" | "save";
}
export declare function handleMessage(params: HandleMessageParams): Promise<HandleMessageResult>;
export {};
//# sourceMappingURL=handle-message.d.ts.map
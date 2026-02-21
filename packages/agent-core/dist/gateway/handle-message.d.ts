import { type SessionCompactionOptions } from "../sessions/compactor.js";
import { SessionStore } from "../sessions/store.js";
import { type ToolPolicy } from "../tools/policy.js";
import type { PluginRuntime } from "../plugins/runtime.js";
import { type GatewayIdempotencyStore, type GatewayLogger, type SessionLockManager } from "./hardening.js";
import type { ToolDefinition } from "../tools.js";
import type { Message } from "../types/message.js";
import type { SessionScope } from "../types/session.js";
import type { RunAgentTurnParams, RunAgentTurnResult } from "../types.js";
import type { LlmProviderClient } from "../llm/types.js";
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
    client: LlmProviderClient;
    text: string;
    systemPrompt: string;
    tools: ToolDefinition[];
    executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
    routing?: HandleMessageRoutingInput;
    sessionStore?: SessionStore;
    toolPolicy?: ToolPolicy;
    sessionCompaction?: SessionCompactionOptions;
    lockManager?: SessionLockManager;
    idempotencyStore?: GatewayIdempotencyStore;
    idempotencyKey?: string;
    logger?: GatewayLogger;
    requestId?: string;
    runTurn?: TurnRunner;
    pluginRuntime?: PluginRuntime;
}
export interface HandleMessageResult {
    text: string;
    messages: Message[];
    usage: RunAgentTurnResult["usage"];
    routing: HandleMessageResolvedRouting;
    persistenceMode: "append" | "save";
    compaction?: {
        compacted: boolean;
        strategy: "none" | "summary" | "tail_trim";
        beforeTokens: number;
        afterTokens: number;
        beforeMessageCount: number;
        afterMessageCount: number;
        summaryPreview?: string;
    } | undefined;
    idempotencyHit?: boolean;
}
export declare function handleMessage(params: HandleMessageParams): Promise<HandleMessageResult>;
export {};
//# sourceMappingURL=handle-message.d.ts.map
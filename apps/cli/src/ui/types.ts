import type {
  GatewayIdempotencyStore,
  HandleMessageResult,
  LlmProviderClient,
  Message,
  PluginRuntime,
  SessionLockManager,
  SessionCompactionOptions,
  SessionScope,
  SessionStore,
  ToolPolicy,
} from "@jihn/agent-core";
import type { ToolDefinition } from "../domain/tool.js";

export type Mode = "menu" | "chat" | "tools";

export interface TranscriptLine {
  kind: "user" | "assistant" | "tool" | "system" | "error";
  text: string;
}

export interface JihnAppProps {
  client: LlmProviderClient;
  model: string;
  tools: ToolDefinition[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  resolveSystemPrompt: (agentId: string) => Promise<string>;
  maxTurns: number;
  maxTokens: number;
  sessionStore?: SessionStore;
  agentId?: string;
  scope?: SessionScope;
  channelId?: string;
  peerId?: string;
  toolPolicy?: ToolPolicy;
  sessionCompaction?: SessionCompactionOptions;
  idempotencyStore?: GatewayIdempotencyStore;
  lockManager?: SessionLockManager;
  pluginRuntime?: PluginRuntime;
  runGatewayTurn?: (input: {
    text: string;
    agentId: string;
    scope: SessionScope | undefined;
    channelId: string;
    peerId: string;
  }) => Promise<HandleMessageResult>;
}

export interface TokenUsage {
  estimatedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export type AgentMessage = Message;

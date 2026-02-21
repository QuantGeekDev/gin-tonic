import type { SessionScope } from "@jihn/agent-core";

export interface AgentTurnDebugOptions {
  simulateCompaction?: boolean;
  compareChannels?: boolean;
}

export interface AgentTurnRequest {
  text: string;
  peerId: string;
  scope?: SessionScope;
  channelId?: string;
  agentId?: string;
  maxTurns?: number;
  maxTokens?: number;
  debug?: AgentTurnDebugOptions;
  idempotencyKey?: string;
}

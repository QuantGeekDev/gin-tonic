import { z } from "zod";
import type { SessionScope } from "@jihn/agent-core";
import {
  createApiSuccessEnvelopeSchema,
  type ApiErrorEnvelope,
} from "../contracts/api";

export const ToolMetaSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const AgentMetaDataSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tools: z.array(ToolMetaSchema),
});

export const TokenUsageSchema = z.object({
  estimatedInputTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const ToolEventSchema = z.union([
  z.object({
    kind: z.literal("call"),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("result"),
    name: z.string(),
    output: z.string(),
  }),
]);

export const SessionDescriptorSchema = z.object({
  agentId: z.string(),
  scope: z.string(),
  channelId: z.string(),
  peerId: z.string(),
  sessionKey: z.string(),
});

export const CompactionInfoSchema = z.object({
  compacted: z.boolean(),
  strategy: z.enum(["none", "summary", "tail_trim"]),
  beforeTokens: z.number(),
  afterTokens: z.number(),
  beforeMessageCount: z.number(),
  afterMessageCount: z.number(),
  summaryPreview: z.string().optional(),
});

export const AgentTurnDataSchema = z.object({
  text: z.string(),
  messages: z.array(z.unknown()),
  usage: TokenUsageSchema,
  toolEvents: z.array(ToolEventSchema),
  provider: z.string(),
  model: z.string(),
  session: SessionDescriptorSchema,
  persistenceMode: z.enum(["append", "save"]),
  compaction: CompactionInfoSchema.nullable(),
  idempotencyHit: z.boolean().optional(),
});

export const CompactionSimulationChannelResultSchema = z.object({
  sessionKey: z.string(),
  compacted: z.boolean(),
  strategy: z.enum(["none", "summary", "tail_trim"]),
  beforeTokens: z.number(),
  afterTokens: z.number(),
  beforeMessageCount: z.number(),
  afterMessageCount: z.number(),
  preview: z.string().nullable(),
});

export const CompactionSimulationDataSchema = z.object({
  mode: z.literal("simulation"),
  simulation: z.object({
    web: CompactionSimulationChannelResultSchema,
    cli: CompactionSimulationChannelResultSchema.nullable(),
    identical: z.boolean().nullable(),
  }),
});

export const MemoryResultItemSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  score: z.number(),
});

export const MemorySearchDataSchema = z.object({
  results: z.array(MemoryResultItemSchema),
});

export const MemorySaveDataSchema = z.object({
  saved: z.object({
    id: z.string(),
    namespace: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string(),
  }),
});

export const MemoryReindexDataSchema = z.object({
  indexed: z.number(),
  skipped: z.number(),
});

export const McpServerStateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  url: z.string(),
  enabled: z.boolean(),
  connected: z.boolean(),
  authMode: z.enum(["none", "bearer", "oauth2"]),
  authorized: z.boolean(),
  sessionId: z.string().optional(),
  lastRefreshAt: z.string().optional(),
  toolCount: z.number(),
  error: z.string().optional(),
});

export const McpToolStateSchema = z.object({
  exposedName: z.string(),
  serverId: z.string(),
  remoteName: z.string(),
  description: z.string(),
});

export const McpSnapshotDataSchema = z.object({
  servers: z.array(McpServerStateSchema),
  tools: z.array(McpToolStateSchema),
  generatedAt: z.string(),
});

export const McpActionDataSchema = z.object({
  action: z.string().optional(),
  refreshed: z.boolean().optional(),
  authorizationUrl: z.string().optional(),
  snapshot: McpSnapshotDataSchema.optional(),
});

export const TelegramDebugEventSchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error"]),
  event: z.string(),
  updateId: z.number().optional(),
  chatId: z.number().optional(),
  detail: z.string().optional(),
});

export const TelegramDebugDataSchema = z.object({
  generatedAt: z.string(),
  transportMode: z.enum(["polling", "webhook"]),
  running: z.boolean(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  lastUpdateId: z.number().optional(),
  stats: z.object({
    received: z.number(),
    replied: z.number(),
    failed: z.number(),
    blocked: z.number(),
    retries: z.number(),
  }),
  outbound: z.object({
    queueDepth: z.number(),
  }),
  recentEvents: z.array(TelegramDebugEventSchema),
});

export const AgentMetaEnvelopeSchema = createApiSuccessEnvelopeSchema(AgentMetaDataSchema);
export const AgentTurnEnvelopeSchema = createApiSuccessEnvelopeSchema(AgentTurnDataSchema);
export const CompactionSimulationEnvelopeSchema = createApiSuccessEnvelopeSchema(
  CompactionSimulationDataSchema,
);
export const McpSnapshotEnvelopeSchema = createApiSuccessEnvelopeSchema(McpSnapshotDataSchema);
export const McpActionEnvelopeSchema = createApiSuccessEnvelopeSchema(McpActionDataSchema);
export const MemorySearchEnvelopeSchema = createApiSuccessEnvelopeSchema(MemorySearchDataSchema);
export const MemorySaveEnvelopeSchema = createApiSuccessEnvelopeSchema(MemorySaveDataSchema);
export const MemoryReindexEnvelopeSchema = createApiSuccessEnvelopeSchema(MemoryReindexDataSchema);
export const TelegramDebugEnvelopeSchema = createApiSuccessEnvelopeSchema(TelegramDebugDataSchema);

export type ToolMeta = z.infer<typeof ToolMetaSchema>;
export type AgentMetaResponse = z.infer<typeof AgentMetaDataSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ToolEvent = z.infer<typeof ToolEventSchema>;
export type SessionDescriptor = z.infer<typeof SessionDescriptorSchema>;
export type CompactionInfo = z.infer<typeof CompactionInfoSchema>;
export type AgentTurnResponse = z.infer<typeof AgentTurnDataSchema>;
export type CompactionSimulationResponse = z.infer<typeof CompactionSimulationDataSchema>;
export type MemoryResultItem = z.infer<typeof MemoryResultItemSchema>;
export type McpServerState = z.infer<typeof McpServerStateSchema>;
export type McpToolState = z.infer<typeof McpToolStateSchema>;
export type McpSnapshotResponse = z.infer<typeof McpSnapshotDataSchema>;
export type TelegramDebugEvent = z.infer<typeof TelegramDebugEventSchema>;
export type TelegramDebugResponse = z.infer<typeof TelegramDebugDataSchema>;
export type ApiErrorPayload = ApiErrorEnvelope;
export type WebSessionScope = SessionScope;

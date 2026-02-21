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
  outboundBackend: z.enum(["memory", "postgres"]),
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
    processing: z.number(),
    retryDepth: z.number(),
    deadLetterDepth: z.number(),
  }),
  recentEvents: z.array(TelegramDebugEventSchema),
});

export const PluginManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number(),
  entry: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  capabilities: z.array(z.string()),
  permissions: z.array(z.string()).optional(),
  executionMode: z.enum(["in_process", "worker_thread"]).optional(),
  description: z.string().optional(),
});

export const PluginStatusSchema = z.object({
  pluginId: z.string(),
  state: z.enum(["enabled", "disabled", "open_circuit"]),
  consecutiveFailures: z.number(),
  circuitOpenedAt: z.string().optional(),
  lastError: z.string().optional(),
  lastUpdatedAt: z.string(),
});

export const PluginEventSchema = z.object({
  timestamp: z.string(),
  name: z.string(),
  pluginId: z.string(),
  sessionKey: z.string().optional(),
  requestId: z.string().optional(),
  channelId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PluginDebugDataSchema = z.object({
  plugins: z.array(PluginManifestSchema),
  statuses: z.array(PluginStatusSchema),
  events: z.array(PluginEventSchema),
  health: z.record(
    z.string(),
    z.object({
      healthy: z.boolean(),
      details: z.string().optional(),
    }),
  ),
});

export const RuntimeSettingDefinitionSchema = z.object({
  key: z.string(),
  category: z.string(),
  description: z.string(),
  applyMode: z.enum(["hot", "restart_required"]),
});

export const RuntimeSettingRecordSchema = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

export const SettingsSnapshotDataSchema = z.object({
  settingsFilePath: z.string(),
  generatedAt: z.string(),
  precedenceMode: z.enum(["runtime_over_env", "env_over_runtime"]).optional(),
  definitions: z.array(RuntimeSettingDefinitionSchema),
  values: z.array(RuntimeSettingRecordSchema),
});

export const SettingsUpdateResultSchema = z.object({
  key: z.string(),
  value: z.string(),
  applyMode: z.enum(["hot", "restart_required"]),
  applied: z.boolean(),
  updatedAt: z.string(),
});

export const SettingsActionDataSchema = z.object({
  update: SettingsUpdateResultSchema.optional(),
  snapshot: SettingsSnapshotDataSchema.optional(),
});

export const BenchmarkScenarioSchema = z.object({
  id: z.string(),
  description: z.string(),
});

export const BenchmarkSummarySchema = z.object({
  totalRequests: z.number(),
  successfulRequests: z.number(),
  failedRequests: z.number(),
  totalDurationMs: z.number(),
  throughputRps: z.number(),
  minMs: z.number().nullable(),
  maxMs: z.number().nullable(),
  avgMs: z.number().nullable(),
  p50Ms: z.number().nullable(),
  p90Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  p99Ms: z.number().nullable(),
});

export const BenchmarkErrorSampleSchema = z.object({
  index: z.number(),
  message: z.string(),
});

export const BenchmarkRunResultSchema = z.object({
  id: z.string(),
  scenario: z.string(),
  label: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  config: z.object({
    samples: z.number(),
    warmup: z.number(),
    concurrency: z.number(),
  }),
  summary: BenchmarkSummarySchema,
  errors: z.array(BenchmarkErrorSampleSchema),
});

export const BenchmarkSnapshotDataSchema = z.object({
  generatedAt: z.string(),
  scenarios: z.array(BenchmarkScenarioSchema),
  runs: z.array(BenchmarkRunResultSchema),
});

export const BenchmarkActionDataSchema = z.object({
  result: BenchmarkRunResultSchema.optional(),
  cleared: z
    .object({
      cleared: z.number(),
    })
    .optional(),
  snapshot: BenchmarkSnapshotDataSchema.optional(),
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
export const PluginDebugEnvelopeSchema = createApiSuccessEnvelopeSchema(PluginDebugDataSchema);
export const SettingsSnapshotEnvelopeSchema = createApiSuccessEnvelopeSchema(SettingsSnapshotDataSchema);
export const SettingsActionEnvelopeSchema = createApiSuccessEnvelopeSchema(SettingsActionDataSchema);
export const BenchmarkSnapshotEnvelopeSchema = createApiSuccessEnvelopeSchema(BenchmarkSnapshotDataSchema);
export const BenchmarkActionEnvelopeSchema = createApiSuccessEnvelopeSchema(BenchmarkActionDataSchema);

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
export type PluginDebugResponse = z.infer<typeof PluginDebugDataSchema>;
export type RuntimeSettingDefinition = z.infer<typeof RuntimeSettingDefinitionSchema>;
export type RuntimeSettingRecord = z.infer<typeof RuntimeSettingRecordSchema>;
export type SettingsSnapshotResponse = z.infer<typeof SettingsSnapshotDataSchema>;
export type SettingsActionResponse = z.infer<typeof SettingsActionDataSchema>;
export type BenchmarkScenario = z.infer<typeof BenchmarkScenarioSchema>;
export type BenchmarkRunResult = z.infer<typeof BenchmarkRunResultSchema>;
export type BenchmarkSnapshotResponse = z.infer<typeof BenchmarkSnapshotDataSchema>;
export type BenchmarkActionResponse = z.infer<typeof BenchmarkActionDataSchema>;
export type ApiErrorPayload = ApiErrorEnvelope;
export type WebSessionScope = SessionScope;

import {
  composeSystemPrompt,
  createLlmProviderClient,
  createPluginRuntimeFromLoaded,
  createSharedToolRuntime,
  createStorageRuntime,
  handleMessage,
  isGatewayError,
  isMcpToolName,
  loadWorkspacePlugins,
  McpServerManager,
  McpToolRegistry,
  parseMcpServersFromEnv,
  resolveLlmConfigFromEnv,
  resolveToolPolicy,
  type SessionCompactionOptions,
} from "@jihn/agent-core";
import type { HandleMessageResult, PluginRuntime } from "@jihn/agent-core";
import { createJihnLogger } from "@jihn/agent-core";
import type { TelegramChannelConfig } from "./config.js";
import type { TelegramTurnInput } from "./telegram/types.js";

function optionalPositive(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export interface TelegramAgentRuntime {
  readonly pluginRuntime: PluginRuntime;
  runTurn(input: TelegramTurnInput): Promise<HandleMessageResult>;
  close(): Promise<void>;
}

export async function createTelegramAgentRuntime(
  config: TelegramChannelConfig,
): Promise<TelegramAgentRuntime> {
  const logger = createJihnLogger({ name: "jihn-channel-telegram" });
  const llm = resolveLlmConfigFromEnv(process.env);
  const client = createLlmProviderClient(llm.providerId);

  const loadedPlugins = await loadWorkspacePlugins({ workspaceDir: process.cwd() });
  for (const issue of loadedPlugins.issues) {
    logger.warn({ pluginId: issue.pluginId, message: issue.message }, "plugin.load.issue");
  }
  const pluginRuntime = createPluginRuntimeFromLoaded(loadedPlugins, {
    warn(message, details) {
      logger.warn({ ...details }, message);
    },
    error(message, details) {
      logger.error({ ...details }, message);
    },
  });

  const storage = createStorageRuntime({
    env: process.env,
    defaultMcpStorePath:
      process.env.JIHN_MCP_SERVERS_FILE ?? `${process.cwd()}/.jihn/mcp-servers.json`,
  });

  const localRuntime = createSharedToolRuntime({
    memoryStore: storage.memoryStore,
    pluginRuntime,
  });

  const mcpRegistry = new McpToolRegistry({
    servers: parseMcpServersFromEnv(process.env.JIHN_MCP_SERVERS),
    cacheTtlMs: optionalPositive(process.env.JIHN_MCP_CACHE_TTL_MS) ?? 30_000,
    clientName: "jihn-channel-telegram",
    clientVersion: "1.0.0",
  });

  const mcpManager = new McpServerManager({
    store: storage.mcpStore,
    registry: mcpRegistry,
    baseUrl: process.env.JIHN_BASE_URL ?? "http://localhost:3000",
  });
  await mcpManager.initializeFromStore();

  const mcpTools = await mcpRegistry.listToolDefinitions();
  const tools = [...localRuntime.definitions, ...mcpTools.toolDefinitions];

  const toolPolicy = resolveToolPolicy(
    process.env.JIHN_TOOL_POLICY_MODE,
    process.env.JIHN_TOOL_POLICY_TOOLS,
  );

  const sessionCompaction: SessionCompactionOptions | undefined =
    optionalPositive(process.env.JIHN_CONTEXT_TOKEN_BUDGET) !== undefined
      ? {
          tokenBudget: optionalPositive(process.env.JIHN_CONTEXT_TOKEN_BUDGET) as number,
          ...(optionalPositive(process.env.JIHN_CONTEXT_TARGET_TOKEN_BUDGET) !== undefined
            ? {
                targetTokenBudget: optionalPositive(
                  process.env.JIHN_CONTEXT_TARGET_TOKEN_BUDGET,
                ) as number,
              }
            : {}),
        }
      : undefined;

  return {
    pluginRuntime,
    async runTurn(input: TelegramTurnInput): Promise<HandleMessageResult> {
      const routedAgentId = input.routing.agentId;
      const systemPrompt = await composeSystemPrompt({
        workspaceDir: process.cwd(),
        agentId: routedAgentId,
        pluginRuntime,
      });

      const result = await handleMessage({
        client,
        model: llm.model,
        tools,
        text: input.text,
        routing: input.routing,
        sessionStore: storage.sessionStore,
        ...(storage.idempotencyStore !== undefined
          ? { idempotencyStore: storage.idempotencyStore }
          : {}),
        ...(storage.lockManager !== undefined
          ? { lockManager: storage.lockManager }
          : {}),
        ...(toolPolicy !== undefined ? { toolPolicy } : {}),
        ...(sessionCompaction !== undefined ? { sessionCompaction } : {}),
        idempotencyKey: input.idempotencyKey,
        systemPrompt,
        maxTurns: config.maxTurns,
        maxTokens: config.maxTokens,
        pluginRuntime,
        async executeTool(name, toolInput) {
          return isMcpToolName(name)
            ? mcpRegistry.executeTool(name, toolInput)
            : localRuntime.execute(name, toolInput);
        },
      });

      return result;
    },
    async close(): Promise<void> {
      if (storage.postgresClient !== undefined) {
        await storage.postgresClient.close();
      }
    },
  };
}

export function toTelegramErrorText(error: unknown): string {
  if (isGatewayError(error)) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

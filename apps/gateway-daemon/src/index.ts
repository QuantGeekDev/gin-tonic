import "dotenv/config";
import { createServer } from "node:http";
import {
  composeSystemPrompt,
  createPluginRuntimeFromLoaded,
  createSharedToolRuntime,
  createStorageRuntime,
  GatewayControlPlaneService,
  isMcpToolName,
  loadWorkspacePlugins,
  McpServerManager,
  McpToolRegistry,
  parseGatewayInboundFrame,
  parseMcpServersFromEnv,
  resolveToolPolicy,
  type SessionCompactionOptions,
  handleMessage,
  createJihnLogger,
} from "@jihn/agent-core";
import { WebSocketServer } from "ws";
import { FixedWindowRateLimiter, parseRateLimitConfig } from "./rate-limit.js";
import { handleGatewayWsFrame, type GatewayWsConnectionState } from "./ws/handler.js";
import { GatewayPrometheusMetrics } from "./metrics.js";
import { RuntimeSettingsService } from "./settings.js";
import { GatewayLlmRuntime } from "./llm-runtime.js";

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

function parseJsonPayload(data: unknown): unknown {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) {
    throw new Error("invalid frame payload");
  }
  const text = typeof data === "string" ? data : data.toString("utf8");
  return JSON.parse(text) as unknown;
}

async function main(): Promise<void> {
  const logger = createJihnLogger({ name: "jihn-gateway-daemon" });
  const settings = new RuntimeSettingsService(process.env);
  await settings.loadIntoEnv(process.env);
  const llmRuntime = new GatewayLlmRuntime();
  llmRuntime.resolve(process.env);

  const loadedPlugins = await loadWorkspacePlugins({ workspaceDir: process.cwd() });
  for (const issue of loadedPlugins.issues) {
    logger.warn({ pluginId: issue.pluginId, message: issue.message }, "plugin.load.issue");
  }
  const pluginRuntime = createPluginRuntimeFromLoaded(loadedPlugins);

  const storage = createStorageRuntime({
    env: process.env,
    defaultMcpStorePath:
      process.env.JIHN_MCP_SERVERS_FILE ?? `${process.cwd()}/.jihn/mcp-servers.json`,
  });

  const mcpRegistry = new McpToolRegistry({
    servers: parseMcpServersFromEnv(process.env.JIHN_MCP_SERVERS),
    cacheTtlMs: optionalPositive(process.env.JIHN_MCP_CACHE_TTL_MS) ?? 30_000,
    clientName: "jihn-gateway-daemon",
    clientVersion: "1.0.0",
  });
  const mcpManager = new McpServerManager({
    store: storage.mcpStore,
    registry: mcpRegistry,
    baseUrl: process.env.JIHN_BASE_URL ?? "http://localhost:3000",
  });
  await mcpManager.initializeFromStore();

  const localRuntime = createSharedToolRuntime({
    memoryStore: storage.memoryStore,
    pluginRuntime,
  });

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

  const gateway = new GatewayControlPlaneService({
    authTokens: process.env.JIHN_GATEWAY_TOKENS
      ? process.env.JIHN_GATEWAY_TOKENS.split(",").map((item) => item.trim()).filter(Boolean)
      : [],
    queue: {
      maxGlobalConcurrency: optionalPositive(process.env.JIHN_GATEWAY_MAX_CONCURRENCY) ?? 4,
      defaultLaneConcurrency: 1,
      laneConcurrency: {
        main: optionalPositive(process.env.JIHN_GATEWAY_MAIN_LANE_CONCURRENCY) ?? 4,
      },
    },
  });
  const rateLimitConfig = parseRateLimitConfig(process.env);
  const rateLimiter = new FixedWindowRateLimiter(rateLimitConfig);
  const gatewayMetrics = new GatewayPrometheusMetrics();

  gateway.setAgentRunHandler(async (params) => {
    const rawScope = params.metadata?.scope as string | undefined;
    const scope: "peer" | "channel-peer" | "global" =
      rawScope === "peer" || rawScope === "channel-peer" || rawScope === "global"
        ? rawScope
        : "channel-peer";
    const routed = {
      agentId: (params.metadata?.agentId as string | undefined) ?? "main",
      scope,
      channelId: (params.metadata?.channelId as string | undefined) ?? "gateway",
      peerId: (params.metadata?.peerId as string | undefined) ?? "gateway-client",
    };

    const systemPrompt = await composeSystemPrompt({
      workspaceDir: process.cwd(),
      agentId: routed.agentId,
      pluginRuntime,
    });

    const mcpTools = await mcpManager.listToolDefinitions();
    const tools = [...localRuntime.definitions, ...mcpTools.toolDefinitions];
    const runtimeLlm = llmRuntime.resolve(process.env);

    const result = await handleMessage({
      client: runtimeLlm.client,
      model: runtimeLlm.model,
      tools,
      text: params.text,
      routing: {
        agentId: routed.agentId,
        scope: routed.scope,
        channelId: routed.channelId,
        peerId: routed.peerId,
      },
      sessionStore: storage.sessionStore,
      ...(storage.idempotencyStore !== undefined
        ? { idempotencyStore: storage.idempotencyStore }
        : {}),
      ...(storage.lockManager !== undefined ? { lockManager: storage.lockManager } : {}),
      ...(toolPolicy !== undefined ? { toolPolicy } : {}),
      ...(sessionCompaction !== undefined ? { sessionCompaction } : {}),
      pluginRuntime,
      systemPrompt,
      async executeTool(name, input) {
        return isMcpToolName(name)
          ? mcpRegistry.executeTool(name, input)
          : localRuntime.execute(name, input);
      },
    });

    return {
      sessionKey: result.routing.sessionKey,
      output: JSON.stringify(result),
    };
  });

  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          nowIso: new Date().toISOString(),
          clients: gateway.getConnectedClientCount(),
          queue: gateway.getQueueSnapshot(),
        }),
      );
      return;
    }
    if (req.url === "/readyz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ready",
          nowIso: new Date().toISOString(),
        }),
      );
      return;
    }
    if (req.url === "/metrics") {
      const queue = gateway.getQueueSnapshot();
      const deadLetters = gateway.getDeadLetters().length;
      gatewayMetrics.setGatewaySnapshot({
        connectedClients: gateway.getConnectedClientCount(),
        queueQueued: queue.queued,
        queueActive: queue.active,
        queueDeadLetters: deadLetters,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; version=0.0.4");
      void gatewayMetrics.render().then((body) => {
        res.end(body);
      });
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (socket) => {
    const state: GatewayWsConnectionState = {
      connectedClientId: null as string | null,
      subscriptions: new Map(),
    };

    socket.on("message", async (data) => {
      let metricMethod = "unknown";
      const metricStartedAt = Date.now();
      try {
        const raw = parseJsonPayload(data);
        const frame = parseGatewayInboundFrame(raw);
        if (frame.type === "req") {
          metricMethod = frame.method;
        } else if (frame.type === "connect") {
          metricMethod = "connect";
        } else {
          metricMethod = frame.type;
        }
        const recordCustomOutcome = (outcome: "ok" | "error"): void => {
          if (frame.type !== "req") {
            return;
          }
          gatewayMetrics.observeAudit({
            method: frame.method,
            outcome,
            durationMs: Math.max(0, Date.now() - metricStartedAt),
          });
        };
        const handledByCore = await handleGatewayWsFrame({
          frame,
          state,
          gateway,
          rateLimiter,
          send(outboundFrame) {
            socket.send(JSON.stringify(outboundFrame));
          },
          onAudit(params) {
            if (params.outcome === "rate_limited") {
              logger.warn(
                {
                  clientId: params.clientId,
                  requestId: params.requestId,
                  method: params.method,
                },
                "gateway.audit.rate_limited",
              );
            }
            logger.info(
              {
                clientId: params.clientId,
                requestId: params.requestId,
                method: params.method,
                durationMs: params.durationMs,
                outcome: params.outcome,
              },
              "gateway.audit.request",
            );
            gatewayMetrics.observeAudit({
              method: params.method,
              outcome: params.outcome,
              durationMs: params.durationMs,
            });
          },
        });
        if (handledByCore) {
          return;
        }

        if (state.connectedClientId === null) {
          socket.send(
            JSON.stringify({
              type: "error",
              code: "UNAUTHORIZED",
              message: "connect handshake required before requests",
            }),
          );
          return;
        }
        if (frame.type !== "req") {
          return;
        }

        if (frame.method === "runtime.meta") {
          const runtimeLlm = llmRuntime.resolve(process.env);
          const mcpTools = await mcpManager.listToolDefinitions();
          const tools = [...localRuntime.definitions, ...mcpTools.toolDefinitions].map((tool) => ({
            name: tool.name,
            description: tool.description,
          }));
          socket.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              result: {
                provider: runtimeLlm.providerId,
                model: runtimeLlm.model,
                tools,
              },
            }),
          );
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "mcp.snapshot") {
          const params = (frame.params ?? {}) as { refresh?: boolean };
          const snapshot = await mcpManager.getSnapshot(params.refresh === true);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: snapshot }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "mcp.add_server") {
          const params = frame.params as {
            id: string;
            url: string;
            name?: string;
            authMode?: "none" | "bearer" | "oauth2";
            bearerToken?: string;
            scope?: string;
            clientId?: string;
            clientSecret?: string;
          };
          const snapshot = await mcpManager.addServer({
            id: params.id,
            url: params.url,
            ...(params.name ? { name: params.name } : {}),
            auth:
              params.authMode === "bearer"
                ? { mode: "bearer", token: params.bearerToken ?? "" }
                : params.authMode === "oauth2"
                  ? {
                      mode: "oauth2",
                      oauth: {
                        ...(params.scope ? { scope: params.scope } : {}),
                        ...(params.clientId ? { clientId: params.clientId } : {}),
                        ...(params.clientSecret ? { clientSecret: params.clientSecret } : {}),
                      },
                    }
                  : { mode: "none" },
          });
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: snapshot }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "mcp.remove_server") {
          const params = frame.params as { id: string };
          const snapshot = await mcpManager.removeServer(params.id);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: snapshot }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "mcp.begin_oauth") {
          const params = frame.params as { id: string };
          const result = await mcpManager.beginOAuth(params.id);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "mcp.complete_oauth") {
          const params = frame.params as { code: string; state: string };
          const result = await mcpManager.completeOAuthCallback(params.code, params.state);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "memory.search") {
          const params = frame.params as { query: string; namespace?: string; limit?: number };
          const result = await storage.memoryStore.searchMemory(params);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "memory.save") {
          const params = frame.params as { text: string; namespace?: string; tags?: string[] };
          const result = await storage.memoryStore.saveMemory(params);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "memory.reindex_embeddings") {
          const params = frame.params as { limit?: number };
          const result = await storage.memoryStore.backfillEmbeddings(params.limit ?? 200);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "plugins.snapshot") {
          const snapshot = {
            plugins: pluginRuntime.listPlugins(),
            statuses: pluginRuntime.listStatuses(),
            events: pluginRuntime.listEvents(),
            health: await pluginRuntime.runHealthChecks(),
          };
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: snapshot }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "settings.snapshot") {
          const snapshot = await settings.snapshot(process.env);
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: snapshot }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "settings.update") {
          const params = (frame.params ?? {}) as {
            key?: string;
            value?: string;
          };
          if (typeof params.key !== "string" || typeof params.value !== "string") {
            socket.send(
              JSON.stringify({
                type: "error",
                id: frame.id,
                code: "INVALID_ARGUMENT",
                message: "settings.update requires { key, value } strings",
              }),
            );
            recordCustomOutcome("error");
            return;
          }
          const llmSettingKeys = new Set([
            "JIHN_LLM_PROVIDER",
            "JIHN_LLM_MODEL",
            "JIHN_LLM_MODEL_ALIAS",
            "OPENAI_MODEL",
            "ANTHROPIC_MODEL",
            "JIHN_ANTHROPIC_MODEL_SONNET",
            "JIHN_ANTHROPIC_MODEL_HAIKU",
          ]);
          if (llmSettingKeys.has(params.key)) {
            const candidateEnv = {
              ...process.env,
              [params.key]: params.value,
            } as NodeJS.ProcessEnv;
            llmRuntime.resolve(candidateEnv);
          }
          const result = await settings.update({
            key: params.key,
            value: params.value,
            updatedBy: state.connectedClientId,
            currentEnv: process.env,
          });

          if (
            result.key === "JIHN_GATEWAY_RATE_LIMIT_REQUESTS" ||
            result.key === "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS"
          ) {
            const nextConfig = parseRateLimitConfig(process.env);
            rateLimiter.reload(nextConfig);
            logger.info({ rateLimit: nextConfig, reason: "settings.update" }, "gateway.daemon.config.reloaded");
          }
          if (llmSettingKeys.has(result.key)) {
            const runtimeLlm = llmRuntime.resolve(process.env);
            logger.info(
              {
                provider: runtimeLlm.providerId,
                model: runtimeLlm.model,
                reason: "settings.update",
              },
              "gateway.daemon.llm.config.reloaded",
            );
          }

          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result }));
          recordCustomOutcome("ok");
          return;
        }

        if (frame.method === "agent.run") {
          const params = frame.params as {
            text: string;
            routing: {
              agentId?: string;
              scope?: "peer" | "channel-peer" | "channel" | "workspace";
              channelId?: string;
              peerId?: string;
            };
          };

          const result = await gateway.request({
            clientId: state.connectedClientId,
            requestId: frame.id,
            method: "agent.run",
            ...(frame.idempotencyKey !== undefined
              ? { idempotencyKey: frame.idempotencyKey }
              : {}),
            payload: {
              sessionKey: `${params.routing?.agentId ?? "main"}:${params.routing?.scope ?? "channel-peer"}:${params.routing?.channelId ?? "gateway"}:${params.routing?.peerId ?? "gateway-client"}`,
              text: params.text,
              metadata: {
                ...(params.routing?.agentId ? { agentId: params.routing.agentId } : {}),
                ...(params.routing?.scope ? { scope: params.routing.scope } : {}),
                ...(params.routing?.channelId ? { channelId: params.routing.channelId } : {}),
                ...(params.routing?.peerId ? { peerId: params.routing.peerId } : {}),
              },
            },
          });

          const parsed = JSON.parse(result.output) as unknown;
          socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, result: parsed }));
          recordCustomOutcome("ok");
          return;
        }

        socket.send(
          JSON.stringify({
            type: "error",
            id: frame.id,
            code: "METHOD_NOT_FOUND",
            message: `Unsupported method: ${frame.method}`,
          }),
        );
        recordCustomOutcome("error");
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        gatewayMetrics.observeAudit({
          method: metricMethod,
          outcome: "error",
          durationMs: Math.max(0, Date.now() - metricStartedAt),
        });
      }
    });

    socket.on("close", () => {
      for (const subscription of state.subscriptions.values()) {
        subscription.unsubscribe();
      }
      state.subscriptions.clear();
      if (state.connectedClientId) {
        gateway.disconnect(state.connectedClientId);
      }
    });
  });

  const host = process.env.JIHN_GATEWAY_HOST ?? "127.0.0.1";
  const port = optionalPositive(process.env.JIHN_GATEWAY_PORT) ?? 18789;

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => resolve());
  });

  logger.info({ host, port, wsPath: "/ws" }, "gateway.daemon.started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "gateway.daemon.shutdown.begin");
    await pluginRuntime.shutdown();
    if (storage.postgresClient !== undefined) {
      await storage.postgresClient.close();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    logger.info({ signal }, "gateway.daemon.shutdown.complete");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGHUP", () => {
    const nextConfig = parseRateLimitConfig(process.env);
    rateLimiter.reload(nextConfig);
    logger.info({ rateLimit: nextConfig }, "gateway.daemon.config.reloaded");
  });
}

void main().catch((error) => {
  const logger = createJihnLogger({ name: "jihn-gateway-daemon" });
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "gateway.daemon.fatal");
  process.exit(1);
});

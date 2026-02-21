import "dotenv/config";
import { render } from "ink";
import { createElement } from "react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JihnApp } from "./ui/app.js";
import { JihnGatewayClient } from "@jihn/gateway-client";
import { runSettingsCliCommand } from "./commands/settings.js";
import { runCompletionCliCommand } from "./commands/completion.js";
import { runBenchmarkCliCommand } from "./commands/benchmark.js";
import {
  composeSystemPrompt,
  createPluginRuntimeFromLoaded,
  createStorageRuntime,
  createLlmProviderClient,
  createSharedToolRuntime,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TURNS,
  isMcpToolName,
  McpServerManager,
  McpToolRegistry,
  parseMcpServersFromEnv,
  loadWorkspacePlugins,
  parsePluginManifest,
  PLUGIN_MANIFEST_FILENAME,
  resolveLlmConfigFromEnv,
  resolveToolPolicy,
  type SessionCompactionOptions,
  type HandleMessageResult,
  SESSION_SCOPES,
  resolvePositiveInteger,
} from "@jihn/agent-core";
import type { SessionScope } from "@jihn/agent-core";

function resolveSessionScope(rawScope: string | undefined): SessionScope {
  if (rawScope && SESSION_SCOPES.includes(rawScope as SessionScope)) {
    return rawScope as SessionScope;
  }
  return "channel-peer";
}

function resolveOptionalPositiveInteger(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function readFlag(
  args: string[],
  names: string[],
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || !names.includes(arg)) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

function hasFlag(args: string[], names: string[]): boolean {
  return args.some((arg) => names.includes(arg));
}

function mcpStoreFilePath(): string {
  return process.env.JIHN_MCP_SERVERS_FILE ?? `${process.cwd()}/.jihn/mcp-servers.json`;
}

function pluginRootDir(): string {
  return join(process.cwd(), "plugins");
}

function printMcpUsage(): void {
  console.log("MCP commands:");
  console.log("  jihn mcp list");
  console.log("  jihn mcp tools");
  console.log("  jihn mcp add --id <id> --url <url> [--name <name>] [--auth none|bearer|oauth2]");
  console.log("                 [--token <bearerToken>] [--scope <oauthScope>]");
  console.log("                 [--client-id <id>] [--client-secret <secret>]");
  console.log("  jihn mcp remove --id <id>");
  console.log("  jihn mcp oauth begin --id <id>");
  console.log("  jihn mcp oauth complete --code <code> --state <state>");
}

function printPluginUsage(): void {
  console.log("Plugin commands:");
  console.log("  jihn plugin list");
  console.log("  jihn plugin validate [--id <id>]");
  console.log("  jihn plugin inspect --id <id>");
  console.log("  jihn plugin enable --id <id>");
  console.log("  jihn plugin disable --id <id>");
  console.log("  jihn plugin create --id <id> [--name <name>]");
}

async function updatePluginEnabledFlag(pluginId: string, enabled: boolean): Promise<void> {
  const manifestPath = join(pluginRootDir(), pluginId, PLUGIN_MANIFEST_FILENAME);
  const raw = await readFile(manifestPath, "utf8");
  const parsed = parsePluginManifest(JSON.parse(raw));
  const next = {
    ...parsed,
    enabled,
  };
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function runPluginCliCommand(args: string[]): Promise<boolean> {
  if (args[0] !== "plugin") {
    return false;
  }

  const subcommand = args[1] ?? "help";
  if (subcommand === "help" || hasFlag(args, ["--help", "-h"])) {
    printPluginUsage();
    return true;
  }

  if (subcommand === "create") {
    const id = readFlag(args, ["--id"]);
    const name = readFlag(args, ["--name"]);
    if (!id) {
      throw new Error("plugin create requires --id");
    }
    const pluginDir = join(pluginRootDir(), id);
    await mkdir(pluginDir, { recursive: true });
    const manifest = {
      id,
      name: name ?? id,
      version: "1.0.0",
      apiVersion: 1,
      entry: "index.mjs",
      enabled: true,
      priority: 0,
      capabilities: ["tools"],
      permissions: [],
      description: "Workspace plugin",
    };
    await writeFile(
      join(pluginDir, PLUGIN_MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(pluginDir, "index.mjs"),
      `export default {
  tools: [
    {
      name: "ping",
      description: "Health check tool",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" }
        }
      },
      async execute(input) {
        return String(input.text ?? "pong");
      }
    }
  ]
};
`,
      "utf8",
    );
    console.log(`Plugin scaffold created at plugins/${id}`);
    return true;
  }

  if (subcommand === "list") {
    const loaded = await loadWorkspacePlugins({ workspaceDir: process.cwd() });
    if (loaded.plugins.length === 0) {
      console.log("No plugins loaded.");
    }
    for (const plugin of loaded.plugins) {
      console.log(
        `${plugin.manifest.id} | v${plugin.manifest.version} | api=${plugin.manifest.apiVersion} | enabled=${plugin.manifest.enabled ? "yes" : "no"} | capabilities=${plugin.manifest.capabilities.join(",")}`,
      );
    }
    for (const issue of loaded.issues) {
      console.log(`[${issue.level}] ${issue.pluginId}: ${issue.message}`);
    }
    return true;
  }

  if (subcommand === "validate") {
    const id = readFlag(args, ["--id"]);
    const loaded = await loadWorkspacePlugins({ workspaceDir: process.cwd() });
    const relevantIssues = id
      ? loaded.issues.filter((issue) => issue.pluginId === id)
      : loaded.issues;
    const relevantPlugins = id
      ? loaded.plugins.filter((plugin) => plugin.manifest.id === id)
      : loaded.plugins;
    if (relevantPlugins.length === 0 && relevantIssues.length === 0) {
      console.log("No matching plugin found.");
      return true;
    }
    if (relevantIssues.length > 0) {
      for (const issue of relevantIssues) {
        console.log(`[${issue.level}] ${issue.pluginId}: ${issue.message}`);
      }
      process.exitCode = 1;
      return true;
    }
    for (const plugin of relevantPlugins) {
      console.log(`ok ${plugin.manifest.id}`);
    }
    return true;
  }

  if (subcommand === "inspect") {
    const id = readFlag(args, ["--id"]);
    if (!id) {
      throw new Error("plugin inspect requires --id");
    }
    const loaded = await loadWorkspacePlugins({ workspaceDir: process.cwd() });
    const plugin = loaded.plugins.find((item) => item.manifest.id === id);
    if (!plugin) {
      const issue = loaded.issues.find((item) => item.pluginId === id);
      if (issue) {
        console.log(`[${issue.level}] ${issue.pluginId}: ${issue.message}`);
      } else {
        console.log(`Plugin not found: ${id}`);
      }
      process.exitCode = 1;
      return true;
    }
    console.log(JSON.stringify(plugin.manifest, null, 2));
    const toolNames = (plugin.plugin.tools ?? []).map((tool) => tool.name);
    console.log(`tools: ${toolNames.length > 0 ? toolNames.join(", ") : "(none)"}`);
    const hookNames = Object.keys(plugin.plugin.hooks ?? {});
    console.log(`hooks: ${hookNames.length > 0 ? hookNames.join(", ") : "(none)"}`);
    return true;
  }

  if (subcommand === "enable" || subcommand === "disable") {
    const id = readFlag(args, ["--id"]);
    if (!id) {
      throw new Error(`plugin ${subcommand} requires --id`);
    }
    await updatePluginEnabledFlag(id, subcommand === "enable");
    console.log(`Plugin ${id} ${subcommand}d.`);
    return true;
  }

  printPluginUsage();
  return true;
}

async function runMcpCliCommand(args: string[]): Promise<boolean> {
  if (args[0] !== "mcp") {
    return false;
  }

  const mcpRegistry = new McpToolRegistry({
    servers: parseMcpServersFromEnv(process.env.JIHN_MCP_SERVERS),
    cacheTtlMs: resolveOptionalPositiveInteger(process.env.JIHN_MCP_CACHE_TTL_MS) ?? 30_000,
    clientName: "jihn-cli",
    clientVersion: "1.0.0",
  });
  const storage = createStorageRuntime({
    env: process.env,
    defaultMcpStorePath: mcpStoreFilePath(),
  });
  try {
    const mcpStore = storage.mcpStore;
    const mcpManager = new McpServerManager({
      store: mcpStore,
      registry: mcpRegistry,
      baseUrl: process.env.JIHN_BASE_URL ?? "http://localhost:3000",
    });
    await mcpManager.initializeFromStore();

    const subcommand = args[1] ?? "help";
    if (subcommand === "help" || hasFlag(args, ["--help", "-h"])) {
      printMcpUsage();
      return true;
    }

    if (subcommand === "list") {
      const snapshot = await mcpManager.getSnapshot(true);
      if (snapshot.servers.length === 0) {
        console.log("No MCP servers configured.");
        return true;
      }
      for (const server of snapshot.servers) {
        console.log(
          [
            `${server.id}${server.name ? ` (${server.name})` : ""}`,
            `url=${server.url}`,
            `auth=${server.authMode}`,
            `authorized=${server.authorized ? "yes" : "no"}`,
            `connected=${server.connected ? "yes" : "no"}`,
            `tools=${server.toolCount}`,
            ...(server.error ? [`error=${server.error}`] : []),
          ].join(" | "),
        );
      }
      return true;
    }

    if (subcommand === "tools") {
      const snapshot = await mcpManager.getSnapshot(true);
      if (snapshot.tools.length === 0) {
        console.log("No MCP tools available.");
        return true;
      }
      for (const tool of snapshot.tools) {
        console.log(`${tool.exposedName} <- ${tool.serverId}.${tool.remoteName}`);
      }
      return true;
    }

    if (subcommand === "add") {
      const id = readFlag(args, ["--id"]);
      const url = readFlag(args, ["--url"]);
      if (!id || !url) {
        throw new Error("mcp add requires --id and --url");
      }

      const authMode = readFlag(args, ["--auth"]) ?? "none";
      const name = readFlag(args, ["--name"]);
      const bearerToken = readFlag(args, ["--token"]);
      const scope = readFlag(args, ["--scope"]);
      const clientId = readFlag(args, ["--client-id"]);
      const clientSecret = readFlag(args, ["--client-secret"]);
      const auth =
        authMode === "none"
          ? { mode: "none" as const }
          : authMode === "bearer"
            ? {
                mode: "bearer" as const,
                token: bearerToken ?? "",
              }
            : authMode === "oauth2"
              ? {
                  mode: "oauth2" as const,
                  oauth: {
                    ...(scope ? { scope } : {}),
                    ...(clientId ? { clientId } : {}),
                    ...(clientSecret ? { clientSecret } : {}),
                  },
                }
              : null;

      if (!auth) {
        throw new Error(`Unsupported --auth mode: ${authMode}`);
      }

      await mcpManager.addServer({
        id,
        url,
        ...(name ? { name } : {}),
        auth,
      });

      console.log(`MCP server saved: ${id}`);
      return true;
    }

    if (subcommand === "remove") {
      const id = readFlag(args, ["--id"]);
      if (!id) {
        throw new Error("mcp remove requires --id");
      }
      await mcpManager.removeServer(id);
      console.log(`MCP server removed: ${id}`);
      return true;
    }

    if (subcommand === "oauth") {
      const action = args[2] ?? "help";
      if (action === "begin") {
        const id = readFlag(args, ["--id"]);
        if (!id) {
          throw new Error("mcp oauth begin requires --id");
        }
        const result = await mcpManager.beginOAuth(id);
        if (!result.authorizationUrl) {
          console.log("Server already authorized.");
        } else {
          console.log(result.authorizationUrl);
        }
        return true;
      }

      if (action === "complete") {
        const code = readFlag(args, ["--code"]);
        const state = readFlag(args, ["--state"]);
        if (!code || !state) {
          throw new Error("mcp oauth complete requires --code and --state");
        }
        const result = await mcpManager.completeOAuthCallback(code, state);
        console.log(`OAuth completed for MCP server: ${result.serverId}`);
        return true;
      }

      printMcpUsage();
      return true;
    }

    printMcpUsage();
    return true;
  } finally {
    if (storage.postgresClient !== undefined) {
      await storage.postgresClient.close();
    }
  }
}

async function main(): Promise<void> {
  const commandArgs = process.argv.slice(2);
  if (await runCompletionCliCommand(commandArgs)) {
    return;
  }
  if (await runSettingsCliCommand(commandArgs)) {
    return;
  }
  if (await runBenchmarkCliCommand(commandArgs)) {
    return;
  }
  if (await runPluginCliCommand(commandArgs)) {
    return;
  }
  if (await runMcpCliCommand(commandArgs)) {
    return;
  }

  const llm = resolveLlmConfigFromEnv(process.env);
  const client = createLlmProviderClient(llm.providerId);
  const model = llm.model;
  const loadedPlugins = await loadWorkspacePlugins({
    workspaceDir: process.cwd(),
  });
  const pluginRuntime = createPluginRuntimeFromLoaded(loadedPlugins);

  const shutdownPlugins = async (): Promise<void> => {
    await pluginRuntime.shutdown();
  };
  process.on("SIGTERM", () => {
    shutdownPlugins().finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    shutdownPlugins().finally(() => process.exit(0));
  });

  const storage = createStorageRuntime({
    env: process.env,
    defaultMcpStorePath: mcpStoreFilePath(),
  });
  const localRuntime = createSharedToolRuntime({
    memoryStore: storage.memoryStore,
    pluginRuntime,
  });
  const mcpRegistry = new McpToolRegistry({
    servers: parseMcpServersFromEnv(process.env.JIHN_MCP_SERVERS),
    cacheTtlMs: resolveOptionalPositiveInteger(process.env.JIHN_MCP_CACHE_TTL_MS) ?? 30_000,
    clientName: "jihn-cli",
    clientVersion: "1.0.0",
  });
  const mcpStore = storage.mcpStore;
  const mcpManager = new McpServerManager({
    store: mcpStore,
    registry: mcpRegistry,
    baseUrl: process.env.JIHN_BASE_URL ?? "http://localhost:3000",
  });
  await mcpManager.initializeFromStore();
  const mcpTools = await mcpRegistry.listToolDefinitions();
  const tools = [...localRuntime.definitions, ...mcpTools.toolDefinitions];
  const gatewayUrl = process.env.JIHN_GATEWAY_URL?.trim();
  const gatewayEnabled = gatewayUrl !== undefined && gatewayUrl.length > 0;
  let gatewayClient: JihnGatewayClient | null = null;
  let resolvedModel = model;
  let resolvedTools = tools;
  let runGatewayTurn:
    | ((input: {
      text: string;
      agentId: string;
      scope: SessionScope | undefined;
      channelId: string;
      peerId: string;
    }) => Promise<HandleMessageResult>)
    | undefined;

  if (gatewayEnabled) {
    gatewayClient = new JihnGatewayClient();
    await gatewayClient.connect({
      url: gatewayUrl,
      ...(process.env.JIHN_GATEWAY_TOKEN !== undefined
        ? { authToken: process.env.JIHN_GATEWAY_TOKEN }
        : {}),
      client: {
        id: "cli-app",
        name: "jihn-cli",
        version: "1.0.0",
        capabilities: ["agent.run", "runtime.meta"],
      },
    });
    const meta = await gatewayClient.request<{
      model: string;
      tools: Array<{ name: string; description: string }>;
    }>("runtime.meta", {});
    resolvedModel = meta.model;
    resolvedTools = meta.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { type: "object", additionalProperties: true },
    }));
    runGatewayTurn = async (input) => {
      return await (gatewayClient as JihnGatewayClient).request(
        "agent.run",
        {
          text: input.text,
          routing: {
            agentId: input.agentId,
            ...(input.scope !== undefined ? { scope: input.scope } : {}),
            channelId: input.channelId,
            peerId: input.peerId,
          },
        },
      );
    };
  }
  const sessionStore = storage.sessionStore;
  const toolPolicy = resolveToolPolicy(
    process.env.JIHN_TOOL_POLICY_MODE,
    process.env.JIHN_TOOL_POLICY_TOOLS,
  );
  const sessionCompaction: SessionCompactionOptions | undefined =
    resolveOptionalPositiveInteger(process.env.JIHN_CONTEXT_TOKEN_BUDGET) !== undefined
      ? {
          tokenBudget: resolvePositiveInteger(
            process.env.JIHN_CONTEXT_TOKEN_BUDGET,
            8000,
          ),
          ...(resolveOptionalPositiveInteger(
            process.env.JIHN_CONTEXT_TARGET_TOKEN_BUDGET,
          ) !== undefined
            ? {
                targetTokenBudget: resolvePositiveInteger(
                  process.env.JIHN_CONTEXT_TARGET_TOKEN_BUDGET,
                  6400,
                ),
              }
            : {}),
        }
      : undefined;
  render(
    createElement(JihnApp, {
      client,
      model: resolvedModel,
      tools: resolvedTools,
      sessionStore,
      agentId: process.env.JIHN_AGENT_ID ?? "main",
      scope: resolveSessionScope(process.env.JIHN_SESSION_SCOPE),
      channelId: process.env.JIHN_CHANNEL_ID ?? "cli",
      peerId: process.env.JIHN_PEER_ID ?? process.env.USER ?? "local-user",
      ...(toolPolicy !== undefined ? { toolPolicy } : {}),
      ...(storage.idempotencyStore !== undefined
        ? { idempotencyStore: storage.idempotencyStore }
        : {}),
      ...(storage.lockManager !== undefined
        ? { lockManager: storage.lockManager }
        : {}),
      pluginRuntime,
      ...(sessionCompaction !== undefined ? { sessionCompaction } : {}),
      ...(runGatewayTurn !== undefined ? { runGatewayTurn } : {}),
      resolveSystemPrompt: async (agentId: string) =>
        composeSystemPrompt({
          workspaceDir: process.cwd(),
          agentId,
          pluginRuntime,
        }),
      maxTurns: resolvePositiveInteger(process.env.AGENT_MAX_TURNS, DEFAULT_MAX_TURNS),
      maxTokens: resolvePositiveInteger(process.env.AGENT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
      async executeTool(name: string, input: Record<string, unknown>) {
        return isMcpToolName(name)
          ? mcpRegistry.executeTool(name, input)
          : localRuntime.execute(name, input);
      },
    }),
  );

  const shutdownGateway = async (): Promise<void> => {
    if (gatewayClient !== null) {
      await gatewayClient.close();
    }
  };
  process.on("SIGTERM", () => {
    void shutdownGateway();
  });
  process.on("SIGINT", () => {
    void shutdownGateway();
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Application failed: ${message}`);
  process.exitCode = 1;
}

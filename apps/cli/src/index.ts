import "dotenv/config";
import { render } from "ink";
import { createElement } from "react";
import { createAnthropicClient } from "./infrastructure/anthropic-client.js";
import { createToolRegistry } from "./infrastructure/register-tools.js";
import { resolveAnthropicModel } from "./providers/anthropic/config.js";
import { JihnApp } from "./ui/app.js";
import {
  composeSystemPrompt,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TURNS,
  SessionStore,
  SESSION_SCOPES,
  resolvePositiveInteger,
} from "@jihn/agent-core";
import type { SessionScope } from "@jihn/agent-core";

function resolveSessionScope(rawScope: string | undefined): SessionScope {
  if (rawScope && SESSION_SCOPES.includes(rawScope as SessionScope)) {
    return rawScope as SessionScope;
  }
  return "peer";
}

function main(): void {
  const client = createAnthropicClient();
  const model = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);
  const registry = createToolRegistry();
  const tools = registry.getDefinitions();
  const sessionStore = new SessionStore();
  render(
    createElement(JihnApp, {
      client,
      model,
      tools,
      sessionStore,
      agentId: process.env.JIHN_AGENT_ID ?? "main",
      scope: resolveSessionScope(process.env.JIHN_SESSION_SCOPE),
      channelId: process.env.JIHN_CHANNEL_ID ?? "cli",
      peerId: process.env.JIHN_PEER_ID ?? process.env.USER ?? "local-user",
      resolveSystemPrompt: async () =>
        composeSystemPrompt({
          workspaceDir: process.cwd(),
          agentId: process.env.JIHN_AGENT_ID ?? "main",
        }),
      maxTurns: resolvePositiveInteger(process.env.AGENT_MAX_TURNS, DEFAULT_MAX_TURNS),
      maxTokens: resolvePositiveInteger(process.env.AGENT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
      async executeTool(name: string, input: Record<string, unknown>) {
        return registry.execute<string>(name, input);
      },
    }),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Application failed: ${message}`);
  process.exitCode = 1;
}

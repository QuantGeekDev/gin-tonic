import type Anthropic from "@anthropic-ai/sdk";
import { runAgentTurn } from "../agent/loop.js";
import { buildSessionKey } from "../sessions/keys.js";
import { SessionStore } from "../sessions/store.js";
import type { ToolDefinition } from "../tools.js";
import type { Message } from "../types/message.js";
import type { SessionScope } from "../types/session.js";
import type { RunAgentTurnParams, RunAgentTurnResult } from "../types.js";

type TurnRunner = (params: RunAgentTurnParams) => Promise<RunAgentTurnResult>;

const DEFAULT_AGENT_ID = "main";
const DEFAULT_SCOPE: SessionScope = "peer";
const DEFAULT_CHANNEL_ID = "unknown-channel";
const DEFAULT_PEER_ID = "anonymous";

const DEFAULT_SESSION_STORE = new SessionStore();

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
  executeTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<string>;
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

function resolveNonEmpty(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function resolveRouting(
  routing?: HandleMessageRoutingInput,
): HandleMessageResolvedRouting {
  const resolved = {
    agentId: resolveNonEmpty(routing?.agentId, DEFAULT_AGENT_ID),
    scope: routing?.scope ?? DEFAULT_SCOPE,
    channelId: resolveNonEmpty(routing?.channelId, DEFAULT_CHANNEL_ID),
    peerId: resolveNonEmpty(routing?.peerId, DEFAULT_PEER_ID),
  };
  const sessionKey = buildSessionKey(resolved);
  return {
    ...resolved,
    sessionKey,
  };
}

function hasStablePrefix(prefix: Message[], value: Message[]): boolean {
  if (prefix.length > value.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (JSON.stringify(prefix[index]) !== JSON.stringify(value[index])) {
      return false;
    }
  }
  return true;
}

export async function handleMessage(
  params: HandleMessageParams,
): Promise<HandleMessageResult> {
  const text = params.text.trim();
  if (text.length === 0) {
    throw new Error("text must be a non-empty string");
  }

  const routing = resolveRouting(params.routing);
  const store = params.sessionStore ?? DEFAULT_SESSION_STORE;
  const runTurn = params.runTurn ?? runAgentTurn;

  const existingMessages = await store.load(routing.sessionKey);
  const turnInputMessages: Message[] = [
    ...existingMessages,
    { role: "user", content: text },
  ];

  const turnParams: RunAgentTurnParams = {
    client: params.client,
    messages: turnInputMessages,
    systemPrompt: params.systemPrompt,
    tools: params.tools,
    executeTool: params.executeTool,
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
    ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
  };

  const turnResult = await runTurn(turnParams);

  let persistenceMode: "append" | "save" = "append";
  if (hasStablePrefix(existingMessages, turnResult.messages)) {
    const newMessages = turnResult.messages.slice(existingMessages.length);
    for (const message of newMessages) {
      await store.append(routing.sessionKey, message);
    }
  } else {
    persistenceMode = "save";
    await store.save(routing.sessionKey, turnResult.messages);
  }

  return {
    text: turnResult.text,
    messages: turnResult.messages,
    usage: turnResult.usage,
    routing,
    persistenceMode,
  };
}

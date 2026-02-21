import { runAgentTurn } from "../agent/loop.js";
import { DEFAULT_LLM_MODEL } from "../llm/registry.js";
import { countContextTokens } from "../llm/token-counting.js";
import { resolveAgentRoute } from "../routing/router.js";
import { buildSessionKey } from "../sessions/keys.js";
import {
  compactSessionMessages,
  type SessionCompactionOptions,
} from "../sessions/compactor.js";
import { SessionStore } from "../sessions/store.js";
import {
  createPolicyExecutor,
  type ToolPolicy,
} from "../tools/policy.js";
import { getJihnTracer, recordGatewayTurn } from "../observability/telemetry.js";
import type { PluginRuntime } from "../plugins/runtime.js";
import {
  buildIdempotencyFingerprint,
  DEFAULT_GATEWAY_LOGGER,
  DEFAULT_IDEMPOTENCY_STORE,
  DEFAULT_SESSION_LOCK_MANAGER,
  GatewayError,
  type GatewayIdempotencyStore,
  type GatewayLogger,
  type SessionLockManager,
} from "./hardening.js";
import type { ToolDefinition } from "../tools.js";
import type { Message } from "../types/message.js";
import type { SessionScope } from "../types/session.js";
import type { RunAgentTurnParams, RunAgentTurnResult } from "../types.js";
import type { LlmProviderClient } from "../llm/types.js";

type TurnRunner = (params: RunAgentTurnParams) => Promise<RunAgentTurnResult>;

const DEFAULT_AGENT_ID = "main";
const DEFAULT_SCOPE: SessionScope = "channel-peer";
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
  client: LlmProviderClient;
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
  compaction?:
    | {
        compacted: boolean;
        strategy: "none" | "summary" | "tail_trim";
        beforeTokens: number;
        afterTokens: number;
        beforeMessageCount: number;
        afterMessageCount: number;
        summaryPreview?: string;
      }
    | undefined;
  idempotencyHit?: boolean;
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
  const initialAgentId = resolveNonEmpty(params.routing?.agentId, DEFAULT_AGENT_ID);
  const routedInput = resolveAgentRoute({
    text: params.text,
    defaultAgentId: initialAgentId,
  });
  const text = routedInput.text.trim();
  if (text.length === 0) {
    throw new GatewayError({
      code: "INVALID_ARGUMENT",
      statusCode: 400,
      message: "text must be a non-empty string",
    });
  }

  const routing = resolveRouting({
    ...params.routing,
    agentId: routedInput.agentId,
  });
  const store = params.sessionStore ?? DEFAULT_SESSION_STORE;
  const lockManager = params.lockManager ?? DEFAULT_SESSION_LOCK_MANAGER;
  const idempotencyStore = params.idempotencyStore ?? DEFAULT_IDEMPOTENCY_STORE;
  const logger = params.logger ?? DEFAULT_GATEWAY_LOGGER;
  const requestId =
    params.requestId ??
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = params.idempotencyKey?.trim();
  const runTurn = params.runTurn ?? runAgentTurn;
  const executeTool = createPolicyExecutor({
    executeTool: params.executeTool,
    ...(params.toolPolicy !== undefined ? { policy: params.toolPolicy } : {}),
    metadata: {
      agentId: routing.agentId,
      scope: routing.scope,
      channelId: routing.channelId,
      peerId: routing.peerId,
      sessionKey: routing.sessionKey,
    },
  });
  const pluginRuntime = params.pluginRuntime;

  return lockManager.runExclusive(routing.sessionKey, async () => {
    const startedAt = Date.now();
    const span = getJihnTracer().startSpan("gateway.handleMessage", {
      attributes: {
        "jihn.agent_id": routing.agentId,
        "jihn.scope": routing.scope,
        "jihn.channel_id": routing.channelId,
        "jihn.peer_id": routing.peerId,
        "jihn.session_key": routing.sessionKey,
      },
    });
    logger.log({
      level: "info",
      event: "gateway.request.start",
      timestamp: new Date().toISOString(),
      requestId,
      sessionKey: routing.sessionKey,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      details: {
        agentId: routing.agentId,
        scope: routing.scope,
        channelId: routing.channelId,
        peerId: routing.peerId,
        textLength: text.length,
      },
    });

    try {
      const requestFingerprint =
        idempotencyKey !== undefined
          ? buildIdempotencyFingerprint({
              text,
              ...(params.model !== undefined ? { model: params.model } : {}),
              ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
              ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
              agentId: routing.agentId,
              scope: routing.scope,
              channelId: routing.channelId,
              peerId: routing.peerId,
            })
          : undefined;

      if (idempotencyKey !== undefined && requestFingerprint !== undefined) {
        const existing = await idempotencyStore.get(routing.sessionKey, idempotencyKey);
        if (existing !== null) {
          if (existing.fingerprint !== requestFingerprint) {
            throw new GatewayError({
              code: "IDEMPOTENCY_CONFLICT",
              statusCode: 409,
              message:
                "idempotencyKey already used for a different request payload",
              details: {
                sessionKey: routing.sessionKey,
                idempotencyKey,
              },
            });
          }

          logger.log({
            level: "info",
            event: "gateway.idempotency.hit",
            timestamp: new Date().toISOString(),
            requestId,
            sessionKey: routing.sessionKey,
            idempotencyKey,
          });
          span.setAttribute("jihn.idempotency_hit", true);
          span.end();
          recordGatewayTurn({
            durationMs: Date.now() - startedAt,
            agentId: routing.agentId,
            scope: routing.scope,
            channelId: routing.channelId,
            success: true,
            idempotencyHit: true,
          });
          return {
            ...existing.result,
            idempotencyHit: true,
          };
        }
      }

      const existingMessages = await store.load(routing.sessionKey);
      let turnInputMessages: Message[] = [
        ...existingMessages,
        { role: "user", content: text },
      ];

      let compaction: HandleMessageResult["compaction"] = undefined;
      if (params.sessionCompaction !== undefined) {
        const countTokens = async (messages: Message[]): Promise<number> => {
          return countContextTokens(params.client, {
            model: params.model ?? DEFAULT_LLM_MODEL,
            systemPrompt: params.systemPrompt,
            tools: params.tools,
            messages,
          });
        };

        const compactionResult = await compactSessionMessages(
          turnInputMessages,
          params.sessionCompaction,
          countTokens,
        );
        turnInputMessages = compactionResult.messages;
        const firstMessage = turnInputMessages[0];
        const summaryPreview =
          firstMessage !== undefined &&
          firstMessage.role === "assistant" &&
          typeof firstMessage.content === "string"
            ? firstMessage.content.slice(0, 280)
            : undefined;
        compaction = {
          compacted: compactionResult.compacted,
          strategy: compactionResult.strategy,
          beforeTokens: compactionResult.beforeTokens,
          afterTokens: compactionResult.afterTokens,
          beforeMessageCount: compactionResult.beforeMessageCount,
          afterMessageCount: compactionResult.afterMessageCount,
          ...(summaryPreview !== undefined ? { summaryPreview } : {}),
        };
      }

      const beforeTurn = pluginRuntime
        ? await pluginRuntime.applyBeforeTurnHooks({
            text,
            systemPrompt: params.systemPrompt,
            routing,
          })
        : { text, systemPrompt: params.systemPrompt };
      if (beforeTurn.text !== text && turnInputMessages.length > 0) {
        const updatedMessages = [...turnInputMessages];
        const lastIndex = updatedMessages.length - 1;
        const last = updatedMessages[lastIndex];
        if (last && last.role === "user" && typeof last.content === "string") {
          updatedMessages[lastIndex] = { ...last, content: beforeTurn.text };
          turnInputMessages = updatedMessages;
        }
      }

      const turnParams: RunAgentTurnParams = {
        client: params.client,
        messages: turnInputMessages,
        systemPrompt: beforeTurn.systemPrompt,
        tools: params.tools,
        async executeTool(name, input) {
          const hookedInput = pluginRuntime
            ? await pluginRuntime.applyBeforeToolCallHooks({
                name,
                input,
                routing,
              })
            : input;
          const output = await executeTool(name, hookedInput);
          if (pluginRuntime === undefined) {
            return output;
          }
          return pluginRuntime.applyAfterToolCallHooks({
            name,
            input: hookedInput,
            output,
            routing,
          });
        },
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

      const result: HandleMessageResult = {
        text: turnResult.text,
        messages: turnResult.messages,
        usage: turnResult.usage,
        routing,
        persistenceMode,
        compaction,
        idempotencyHit: false,
      };

      if (pluginRuntime !== undefined) {
        await pluginRuntime.runAfterTurnHooks({
          text: beforeTurn.text,
          systemPrompt: beforeTurn.systemPrompt,
          routing,
          result,
        });
      }

      if (idempotencyKey !== undefined && requestFingerprint !== undefined) {
        await idempotencyStore.set(routing.sessionKey, idempotencyKey, {
          fingerprint: requestFingerprint,
          result,
          createdAtMs: Date.now(),
        });
      }

      logger.log({
        level: "info",
        event: "gateway.request.complete",
        timestamp: new Date().toISOString(),
        requestId,
        sessionKey: routing.sessionKey,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        details: {
          durationMs: Date.now() - startedAt,
          persistenceMode,
          compacted: compaction?.compacted ?? false,
          idempotencyHit: false,
        },
      });
      span.setAttribute("jihn.idempotency_hit", false);
      span.setAttribute("jihn.persistence_mode", persistenceMode);
      span.setAttribute("jihn.compaction_strategy", compaction?.strategy ?? "none");
      span.end();
      recordGatewayTurn({
        durationMs: Date.now() - startedAt,
        agentId: routing.agentId,
        scope: routing.scope,
        channelId: routing.channelId,
        success: true,
        idempotencyHit: false,
      });

      return result;
    } catch (error) {
      const gatewayError =
        error instanceof GatewayError
          ? error
          : error instanceof Error && error.name === "ToolPolicyError"
            ? new GatewayError({
                code: "TOOL_POLICY_BLOCKED",
                message: error.message,
                statusCode: 403,
                cause: error,
              })
          : new GatewayError({
              code: "INTERNAL_ERROR",
              message: "Gateway turn failed",
              statusCode: 500,
              cause: error,
            });

      logger.log({
        level: "error",
        event: "gateway.request.error",
        timestamp: new Date().toISOString(),
        requestId,
        sessionKey: routing.sessionKey,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        details: {
          code: gatewayError.code,
          message: gatewayError.message,
          statusCode: gatewayError.statusCode,
          ...(gatewayError.details !== undefined
            ? { errorDetails: gatewayError.details }
            : {}),
        },
      });
      span.recordException(gatewayError);
      span.setAttribute("jihn.error_code", gatewayError.code);
      span.end();
      recordGatewayTurn({
        durationMs: Date.now() - startedAt,
        agentId: routing.agentId,
        scope: routing.scope,
        channelId: routing.channelId,
        success: false,
        idempotencyHit: false,
      });
      throw gatewayError;
    }
  });
}

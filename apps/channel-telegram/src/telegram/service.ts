import { Bot, GrammyError, HttpError } from "grammy";
import type { Context } from "grammy";
import { webhookCallback } from "grammy";
import { createServer, type Server } from "node:http";
import {
  ChannelAuthPairingMiddleware,
  FileChannelPairingStore,
  createJihnLogger,
} from "@jihn/agent-core";
import { buildTelegramTurnInput } from "./bridge.js";
import { buildTelegramReplyOptions, sendTelegramReply } from "./reply.js";
import type { TelegramInboundMessage } from "./types.js";
import type { TelegramChannelConfig } from "../config.js";
import type { TelegramAgentRuntime } from "../runtime.js";
import { toTelegramErrorText } from "../runtime.js";
import { TelegramDebugStore } from "../debug-store.js";
import { TelegramOutboundQueue } from "./outbound-queue.js";
import { createOutboxStoreFromEnv } from "./outbox-store.js";
import { TelegramPrometheusMetrics } from "./metrics.js";
import { startTelegramTypingIndicator } from "./typing.js";

const logger = createJihnLogger({ name: "jihn-channel-telegram" });

function readMessageText(message: NonNullable<Context["message"]>): string | null {
  if ("text" in message && typeof message.text === "string" && message.text.trim().length > 0) {
    return message.text.trim();
  }
  if (
    "caption" in message &&
    typeof message.caption === "string" &&
    message.caption.trim().length > 0
  ) {
    return message.caption.trim();
  }
  return null;
}

function toInboundMessage(ctx: Context): TelegramInboundMessage | null {
  const message = ctx.message;
  if (!message) {
    return null;
  }
  const text = readMessageText(message);
  if (text === null) {
    return null;
  }

  const from = message.from;
  if (!from) {
    return null;
  }

  const chatType = message.chat.type;
  const isDirectMessage = chatType === "private";

  return {
    updateId: ctx.update.update_id,
    messageId: message.message_id,
    chatId: message.chat.id,
    userId: from.id,
    text,
    isDirectMessage,
    isTopicMessage: "is_topic_message" in message ? Boolean(message.is_topic_message) : false,
    ...("message_thread_id" in message && typeof message.message_thread_id === "number"
      ? { messageThreadId: message.message_thread_id }
      : {}),
  };
}

export interface TelegramChannelService {
  bot: Bot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createTelegramChannelService(params: {
  config: TelegramChannelConfig;
  runtime: TelegramAgentRuntime;
}): TelegramChannelService {
  const { config, runtime } = params;
  const bot = new Bot(config.telegramBotToken);
  const debugStore = new TelegramDebugStore({
    filePath: config.debugFilePath,
    maxEvents: config.debugMaxEvents,
    transportMode: config.transportMode,
    outboundBackend: config.outboundBackend,
  });
  const outboxStore = createOutboxStoreFromEnv({
    ...process.env,
    JIHN_TELEGRAM_OUTBOX_BACKEND: config.outboundBackend,
  });
  const metrics = new TelegramPrometheusMetrics();
  let metricsServer: Server | null = null;
  const updateMetricsSnapshot = async (): Promise<void> => {
    const snapshot = await outboundQueue.snapshot();
    metrics.setSnapshot(snapshot);
    await debugStore.setOutboundStats({
      queueDepth: snapshot.queued,
      processing: snapshot.processing,
      retryDepth: snapshot.retry,
      deadLetterDepth: snapshot.dead,
    });
    const deadLetters = await outboundQueue.deadLetters(1);
    const oldest = deadLetters[0];
    if (oldest === undefined) {
      metrics.setDeadLetterOldestAgeSeconds(0);
    } else {
      metrics.setDeadLetterOldestAgeSeconds(Math.max(0, (Date.now() - oldest.createdAtMs) / 1000));
    }
  };
  const outboundQueue = new TelegramOutboundQueue({
    maxAttempts: config.outboundMaxAttempts,
    baseDelayMs: config.outboundBaseDelayMs,
    store: outboxStore,
    send: async (payload) => {
      await sendTelegramReply({
        api: bot.api,
        chatId: payload.chatId,
        text: payload.text,
        options: payload.options,
      });
    },
    onRetry: async (params) => {
      await debugStore.increment("retries");
      metrics.observeRetry({
        failureCode: params.failure.code,
        queueLatencyMs: params.queueLatencyMs,
        processLatencyMs: params.processLatencyMs,
      });
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "outbound_retry",
        detail: `record=${params.recordId} attempt=${params.attempt} delayMs=${params.delayMs} code=${params.failure.code} error=${params.failure.message}`,
      });
      await updateMetricsSnapshot();
    },
    onDeadLetter: async (params) => {
      metrics.observeDeadLetter({
        failureCode: params.failure.code,
        queueLatencyMs: params.queueLatencyMs,
        processLatencyMs: params.processLatencyMs,
      });
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "outbound_dead_letter",
        detail: `record=${params.recordId} attempts=${params.attempts} code=${params.failure.code} error=${params.failure.message}`,
      });
      await updateMetricsSnapshot();
    },
    onEnqueued: async (params) => {
      metrics.observeEnqueue({ latencyMs: params.enqueueLatencyMs });
      await updateMetricsSnapshot();
    },
    onSent: async (params) => {
      metrics.observeSent({
        queueLatencyMs: params.queueLatencyMs,
        processLatencyMs: params.processLatencyMs,
      });
      await updateMetricsSnapshot();
    },
  });
  let webhookServer: Server | null = null;
  const authMiddleware = new ChannelAuthPairingMiddleware({
    mode: config.authMode,
    store: new FileChannelPairingStore(config.authStoreFilePath),
    hashSecret: config.authHashSecret ?? config.telegramBotToken,
    codeLength: config.authCodeLength,
    codeTtlMs: config.authCodeTtlMs,
    maxAttempts: config.authMaxAttempts,
  });

  bot.catch((error) => {
    const context = error.ctx;
    logger.error(
      {
        updateId: context.update.update_id,
        error: error.error instanceof Error ? error.error.message : String(error.error),
      },
      "telegram.update.error",
    );

    if (error.error instanceof GrammyError) {
      logger.error({ description: error.error.description }, "telegram.grammy.error");
    } else if (error.error instanceof HttpError) {
      logger.error({ message: error.error.message }, "telegram.http.error");
    }
    void debugStore.noteEvent({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "update_error",
      updateId: context.update.update_id,
      detail: error.error instanceof Error ? error.error.message : String(error.error),
    });
  });

  bot.on("message", async (ctx) => {
    const inbound = toInboundMessage(ctx);
    if (inbound === null) {
      return;
    }

    if (config.allowedChatIds !== null && !config.allowedChatIds.has(inbound.chatId)) {
      logger.warn({ chatId: inbound.chatId }, "telegram.chat.blocked");
      await debugStore.increment("blocked");
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "message_blocked",
        updateId: inbound.updateId,
        chatId: inbound.chatId,
      });
      return;
    }

    const authDecision = await authMiddleware.evaluate({
      channelId: "telegram",
      senderId: `chat:${inbound.chatId}:user:${inbound.userId}`,
      text: inbound.text,
    });
    if (authDecision.decision === "deny") {
      await debugStore.increment("blocked");
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "info",
        event: `auth_${authDecision.reason}`,
        updateId: inbound.updateId,
        chatId: inbound.chatId,
      });
      await outboundQueue.enqueue({
        accountKey: `chat:${inbound.chatId}`,
        payload: {
          chatId: inbound.chatId,
          text: authDecision.responseText,
          options: buildTelegramReplyOptions({
            message: inbound,
            replyToIncomingByDefault: true,
          }),
          updateId: inbound.updateId,
        },
      });
      await updateMetricsSnapshot();
      return;
    }
    await debugStore.increment("received");
    await debugStore.noteEvent({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "message_received",
      updateId: inbound.updateId,
      chatId: inbound.chatId,
    });

    logger.info(
      {
        updateId: inbound.updateId,
        chatId: inbound.chatId,
        messageId: inbound.messageId,
        userId: inbound.userId,
      },
      "telegram.message.received",
    );

    try {
      const typing =
        config.typingIndicatorEnabled
          ? startTelegramTypingIndicator({
              api: bot.api,
              chatId: inbound.chatId,
              ...(inbound.messageThreadId !== undefined
                ? { messageThreadId: inbound.messageThreadId }
                : {}),
              intervalMs: config.typingIntervalMs,
            })
          : null;
      const turnInput = buildTelegramTurnInput({
        message: inbound,
        agentId: config.agentId,
        sessionScope: config.sessionScope,
      });
      const result = await (async () => {
        try {
          return await runtime.runTurn(turnInput);
        } finally {
          typing?.stop();
        }
      })();

      await outboundQueue.enqueue({
        accountKey: `chat:${inbound.chatId}`,
        payload: {
          chatId: inbound.chatId,
          text: result.text,
          options: buildTelegramReplyOptions({
            message: inbound,
            replyToIncomingByDefault: config.replyToIncomingByDefault,
          }),
          updateId: inbound.updateId,
        },
      });
      await updateMetricsSnapshot();
      await debugStore.increment("replied");
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "message_replied",
        updateId: inbound.updateId,
        chatId: inbound.chatId,
      });

      logger.info(
        {
          updateId: inbound.updateId,
          sessionKey: result.routing.sessionKey,
          idempotencyHit: result.idempotencyHit ?? false,
        },
        "telegram.message.replied",
      );
    } catch (error) {
      const errorText = toTelegramErrorText(error);
      await debugStore.increment("failed");
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "turn_failed",
        updateId: inbound.updateId,
        chatId: inbound.chatId,
        detail: errorText,
      });
      logger.error(
        {
          updateId: inbound.updateId,
          error: errorText,
        },
        "telegram.turn.failed",
      );
      await outboundQueue.enqueue({
        accountKey: `chat:${inbound.chatId}`,
        payload: {
          chatId: inbound.chatId,
          text: `Request failed: ${errorText}`,
          options: buildTelegramReplyOptions({
            message: inbound,
            replyToIncomingByDefault: true,
          }),
          updateId: inbound.updateId,
        },
      });
      await updateMetricsSnapshot();
    }
  });

  return {
    bot,
    async start(): Promise<void> {
      logger.info(
        {
          agentId: config.agentId,
          scope: config.sessionScope,
          transportMode: config.transportMode,
        },
        "telegram.start",
      );
      await debugStore.noteStart();
      await outboundQueue.start();
      await updateMetricsSnapshot();
      if (config.metricsEnabled) {
        metricsServer = createServer((req, res) => {
          if (!req.url || !req.url.startsWith(config.metricsPath)) {
            res.statusCode = 404;
            res.end("Not Found");
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "text/plain; version=0.0.4");
          void metrics.render().then((body) => {
            res.end(body);
          });
        });
        await new Promise<void>((resolve, reject) => {
          const server = metricsServer as Server;
          server.once("error", reject);
          server.listen(config.metricsPort, config.metricsHost, () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        await debugStore.noteEvent({
          timestamp: new Date().toISOString(),
          level: "info",
          event: "metrics_ready",
          detail: `${config.metricsHost}:${config.metricsPort}${config.metricsPath}`,
        });
      }
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "service_started",
      });

      if (config.transportMode === "polling") {
        await bot.start();
        return;
      }

      const baseUrl = config.webhookPublicBaseUrl as string;
      const webhookUrl = `${baseUrl.replace(/\/+$/, "")}${config.webhookPath}`;
      await bot.api.setWebhook(webhookUrl, {
        ...(config.webhookSecret !== null ? { secret_token: config.webhookSecret } : {}),
      });
      const callback = webhookCallback(bot, "http");
      webhookServer = createServer((req, res) => {
        if (!req.url || !req.url.startsWith(config.webhookPath)) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        if (config.webhookSecret !== null) {
          const header = req.headers["x-telegram-bot-api-secret-token"];
          const presented = Array.isArray(header) ? header[0] : header;
          if (presented !== config.webhookSecret) {
            res.statusCode = 401;
            res.end("Unauthorized");
            return;
          }
        }
        void callback(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        const server = webhookServer as Server;
        server.once("error", reject);
        server.listen(config.webhookPort, config.webhookHost, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "webhook_ready",
        detail: `${config.webhookHost}:${config.webhookPort}${config.webhookPath}`,
      });
    },
    async stop(): Promise<void> {
      logger.info({}, "telegram.stop");
      if (config.transportMode === "webhook") {
        await bot.api.deleteWebhook();
      }
      bot.stop();
      await outboundQueue.stop();
      await outboxStore.close();
      if (metricsServer !== null) {
        await new Promise<void>((resolve, reject) => {
          metricsServer?.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        metricsServer = null;
      }
      if (webhookServer !== null) {
        await new Promise<void>((resolve, reject) => {
          webhookServer?.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        webhookServer = null;
      }
      await debugStore.noteEvent({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "service_stopped",
      });
      await debugStore.noteStop();
    },
  };
}

export { toInboundMessage };

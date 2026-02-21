import type { TelegramReplyOptions } from "./reply.js";
import {
  createOutboxStoreFromEnv,
  formatOutboxError,
  type TelegramOutboxPayload,
  type TelegramOutboxStore,
  type TelegramOutboxStats,
} from "./outbox-store.js";

export interface TelegramOutboundMessage {
  accountKey: string;
  payload: TelegramOutboxPayload;
}

export interface TelegramDeliveryFailure {
  retryable: boolean;
  code: "rate_limit" | "network" | "server" | "client" | "auth" | "unknown";
  message: string;
}

export interface TelegramOutboundQueueOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  pollIntervalMs?: number;
  store?: TelegramOutboxStore;
  maxGlobalConcurrency?: number;
  send: (payload: {
    chatId: number;
    text: string;
    options: TelegramReplyOptions;
    tts?: {
      mode: "text_and_voice" | "voice_only";
      voiceId?: string;
      modelId?: string;
      outputFormat?: string;
    };
  }) => Promise<void>;
  classifyError?: (error: unknown) => TelegramDeliveryFailure;
  onRetry?: (params: {
    recordId: string;
    accountKey: string;
    attempt: number;
    delayMs: number;
    queueLatencyMs: number;
    processLatencyMs: number;
    failure: TelegramDeliveryFailure;
  }) => Promise<void> | void;
  onDeadLetter?: (params: {
    recordId: string;
    accountKey: string;
    attempts: number;
    queueLatencyMs: number;
    processLatencyMs: number;
    failure: TelegramDeliveryFailure;
  }) => Promise<void> | void;
  onEnqueued?: (params: {
    recordId: string;
    accountKey: string;
    enqueueLatencyMs: number;
  }) => Promise<void> | void;
  onSent?: (params: {
    recordId: string;
    accountKey: string;
    attempts: number;
    queueLatencyMs: number;
    processLatencyMs: number;
  }) => Promise<void> | void;
}

export interface TelegramOutboundQueueSnapshot {
  queued: number;
  processing: number;
  sent: number;
  dead: number;
  retry: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorMessage(error: unknown): string {
  return formatOutboxError(error);
}

export function classifyTelegramDeliveryError(error: unknown): TelegramDeliveryFailure {
  const text = normalizeErrorMessage(error).toLowerCase();

  if (text.includes("429") || text.includes("too many requests") || text.includes("flood")) {
    return {
      retryable: true,
      code: "rate_limit",
      message: normalizeErrorMessage(error),
    };
  }

  if (
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("eai_again") ||
    text.includes("network")
  ) {
    return {
      retryable: true,
      code: "network",
      message: normalizeErrorMessage(error),
    };
  }

  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("504")) {
    return {
      retryable: true,
      code: "server",
      message: normalizeErrorMessage(error),
    };
  }

  if (
    text.includes("401") ||
    text.includes("403") ||
    text.includes("unauthorized") ||
    text.includes("forbidden")
  ) {
    return {
      retryable: false,
      code: "auth",
      message: normalizeErrorMessage(error),
    };
  }

  if (
    text.includes("400") ||
    text.includes("404") ||
    text.includes("chat not found") ||
    text.includes("bot was blocked")
  ) {
    return {
      retryable: false,
      code: "client",
      message: normalizeErrorMessage(error),
    };
  }

  return {
    retryable: true,
    code: "unknown",
    message: normalizeErrorMessage(error),
  };
}

export class TelegramOutboundQueue {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxGlobalConcurrency: number;
  private readonly send: (payload: {
    chatId: number;
    text: string;
    options: TelegramReplyOptions;
    tts?: {
      mode: "text_and_voice" | "voice_only";
      voiceId?: string;
      modelId?: string;
      outputFormat?: string;
    };
  }) => Promise<void>;
  private readonly classifyError: (error: unknown) => TelegramDeliveryFailure;
  private readonly onRetry:
    | ((params: {
        recordId: string;
        accountKey: string;
        attempt: number;
        delayMs: number;
        queueLatencyMs: number;
        processLatencyMs: number;
        failure: TelegramDeliveryFailure;
      }) => Promise<void> | void)
    | undefined;
  private readonly onDeadLetter:
    | ((params: {
        recordId: string;
        accountKey: string;
        attempts: number;
        queueLatencyMs: number;
        processLatencyMs: number;
        failure: TelegramDeliveryFailure;
      }) => Promise<void> | void)
    | undefined;
  private readonly onEnqueued:
    | ((params: {
        recordId: string;
        accountKey: string;
        enqueueLatencyMs: number;
      }) => Promise<void> | void)
    | undefined;
  private readonly onSent:
    | ((params: {
        recordId: string;
        accountKey: string;
        attempts: number;
        queueLatencyMs: number;
        processLatencyMs: number;
      }) => Promise<void> | void)
    | undefined;

  private readonly store: TelegramOutboxStore;
  private readonly ownsStore: boolean;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;
  private activeWorkers = 0;

  public constructor(options: TelegramOutboundQueueOptions) {
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxGlobalConcurrency = Math.max(1, options.maxGlobalConcurrency ?? 1);
    this.send = options.send;
    this.classifyError = options.classifyError ?? classifyTelegramDeliveryError;
    this.onRetry = options.onRetry;
    this.onDeadLetter = options.onDeadLetter;
    this.onEnqueued = options.onEnqueued;
    this.onSent = options.onSent;

    if (options.store) {
      this.store = options.store;
      this.ownsStore = false;
    } else {
      this.store = createOutboxStoreFromEnv();
      this.ownsStore = true;
    }
  }

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.closed = false;

    await this.store.recoverStuckProcessing(Date.now());

    this.timer = setInterval(() => {
      void this.pump();
    }, this.pollIntervalMs);

    await this.pump();
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    while (this.activeWorkers > 0) {
      await delay(20);
    }

    if (this.ownsStore) {
      await this.store.close();
    }
  }

  public async enqueue(message: TelegramOutboundMessage): Promise<string> {
    const startedAt = Date.now();
    const record = await this.store.enqueue({
      accountKey: message.accountKey,
      payload: message.payload,
      availableAtMs: Date.now(),
    });
    if (this.onEnqueued !== undefined) {
      await this.onEnqueued({
        recordId: record.id,
        accountKey: record.accountKey,
        enqueueLatencyMs: Math.max(0, Date.now() - startedAt),
      });
    }
    await this.pump();
    return record.id;
  }

  public async snapshot(): Promise<TelegramOutboundQueueSnapshot> {
    const stats = await this.store.stats();
    return this.toSnapshot(stats);
  }

  public async deadLetters(limit = 20): Promise<
    Array<{
      id: string;
      accountKey: string;
      attempts: number;
      error: string | null;
      createdAtMs: number;
      updatedAtMs: number;
      updateId?: number;
    }>
  > {
    const items = await this.store.listDead(limit);
    return items.map((item) => ({
      id: item.id,
      accountKey: item.accountKey,
      attempts: item.attempts,
      error: item.lastError,
      createdAtMs: item.createdAtMs,
      updatedAtMs: item.updatedAtMs,
      ...(item.payload.updateId !== undefined ? { updateId: item.payload.updateId } : {}),
    }));
  }

  private async pump(): Promise<void> {
    if (!this.running || this.closed) {
      return;
    }

    while (this.activeWorkers < this.maxGlobalConcurrency) {
      const next = await this.store.claimNextReady(Date.now());
      if (!next) {
        return;
      }
      this.activeWorkers += 1;
      void this.runRecord(next).finally(() => {
        this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      });
    }
  }

  private async runRecord(record: {
    id: string;
    accountKey: string;
    attempts: number;
    createdAtMs: number;
    payload: {
      chatId: number;
      text: string;
      options: TelegramReplyOptions;
      tts?: {
        mode: "text_and_voice" | "voice_only";
        voiceId?: string;
        modelId?: string;
        outputFormat?: string;
      };
    };
  }): Promise<void> {
    const processStartedAt = Date.now();
    try {
      await this.send({
        chatId: record.payload.chatId,
        text: record.payload.text,
        options: record.payload.options,
        ...(record.payload.tts !== undefined ? { tts: record.payload.tts } : {}),
      });
      const completedAt = Date.now();
      await this.store.markSent({ id: record.id, nowMs: completedAt });
      if (this.onSent !== undefined) {
        await this.onSent({
          recordId: record.id,
          accountKey: record.accountKey,
          attempts: record.attempts + 1,
          queueLatencyMs: Math.max(0, completedAt - record.createdAtMs),
          processLatencyMs: Math.max(0, completedAt - processStartedAt),
        });
      }
      return;
    } catch (error) {
      const failure = this.classifyError(error);
      const nextAttempt = record.attempts + 1;
      const nowMs = Date.now();
      const queueLatencyMs = Math.max(0, nowMs - record.createdAtMs);
      const processLatencyMs = Math.max(0, nowMs - processStartedAt);

      if (!failure.retryable || nextAttempt >= this.maxAttempts) {
        await this.store.markDead({
          id: record.id,
          nowMs,
          attempts: nextAttempt,
          errorMessage: failure.message,
        });
        if (this.onDeadLetter !== undefined) {
          await this.onDeadLetter({
            recordId: record.id,
            accountKey: record.accountKey,
            attempts: nextAttempt,
            queueLatencyMs,
            processLatencyMs,
            failure,
          });
        }
        return;
      }

      const delayMs = Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, Math.max(0, record.attempts)));
      const availableAtMs = nowMs + delayMs;
      await this.store.markRetry({
        id: record.id,
        nowMs,
        attempts: nextAttempt,
        availableAtMs,
        errorMessage: failure.message,
      });
      if (this.onRetry !== undefined) {
        await this.onRetry({
          recordId: record.id,
          accountKey: record.accountKey,
          attempt: nextAttempt,
          delayMs,
          queueLatencyMs,
          processLatencyMs,
          failure,
        });
      }
    } finally {
      if (this.running && !this.closed) {
        void this.pump();
      } else {
        await this.store.releaseClaim({ id: record.id, nowMs: Date.now() });
      }
    }
  }

  private toSnapshot(stats: TelegramOutboxStats): TelegramOutboundQueueSnapshot {
    return {
      queued: stats.pending + stats.retry,
      processing: stats.processing,
      sent: stats.sent,
      dead: stats.dead,
      retry: stats.retry,
    };
  }
}

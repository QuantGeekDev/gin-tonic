import {
  createPostgresStorageClient,
  resolveDatabaseUrl,
  type PostgresStorageClient,
} from "@jihn/agent-core";
import type { TelegramReplyOptions } from "./reply.js";

export type OutboxStatus = "pending" | "retry" | "processing" | "sent" | "dead";

export interface TelegramOutboxPayload {
  chatId: number;
  text: string;
  options: TelegramReplyOptions;
  tts?: {
    mode: "text_and_voice" | "voice_only";
    voiceId?: string;
    modelId?: string;
    outputFormat?: string;
  };
  updateId?: number;
}

export interface TelegramOutboxRecord {
  id: string;
  accountKey: string;
  payload: TelegramOutboxPayload;
  status: OutboxStatus;
  attempts: number;
  availableAtMs: number;
  lastError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TelegramOutboxStats {
  pending: number;
  retry: number;
  processing: number;
  sent: number;
  dead: number;
}

export interface TelegramOutboxStore {
  enqueue(entry: {
    accountKey: string;
    payload: TelegramOutboxPayload;
    availableAtMs: number;
  }): Promise<TelegramOutboxRecord>;
  claimNextReady(nowMs: number): Promise<TelegramOutboxRecord | null>;
  markSent(params: { id: string; nowMs: number }): Promise<void>;
  markRetry(params: {
    id: string;
    nowMs: number;
    attempts: number;
    availableAtMs: number;
    errorMessage: string;
  }): Promise<void>;
  markDead(params: {
    id: string;
    nowMs: number;
    attempts: number;
    errorMessage: string;
  }): Promise<void>;
  releaseClaim(params: { id: string; nowMs: number }): Promise<void>;
  recoverStuckProcessing(nowMs: number): Promise<number>;
  stats(): Promise<TelegramOutboxStats>;
  listDead(limit: number): Promise<TelegramOutboxRecord[]>;
  close(): Promise<void>;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function toRecord(value: {
  id: string;
  account_key: string;
  payload: unknown;
  status: string;
  attempts: number;
  available_at_ms: number;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}): TelegramOutboxRecord | null {
  if (
    typeof value.payload !== "object" ||
    value.payload === null ||
    Array.isArray(value.payload)
  ) {
    return null;
  }
  const payload = value.payload as {
    chatId?: unknown;
    text?: unknown;
    options?: unknown;
    tts?: unknown;
    updateId?: unknown;
  };
  if (typeof payload.chatId !== "number" || !Number.isFinite(payload.chatId)) {
    return null;
  }
  if (typeof payload.text !== "string") {
    return null;
  }
  if (typeof payload.options !== "object" || payload.options === null || Array.isArray(payload.options)) {
    return null;
  }
  const options = payload.options as {
    messageThreadId?: unknown;
    replyToMessageId?: unknown;
  };
  const ttsPayload =
    typeof payload.tts === "object" && payload.tts !== null && !Array.isArray(payload.tts)
      ? (payload.tts as {
          mode?: unknown;
          voiceId?: unknown;
          modelId?: unknown;
          outputFormat?: unknown;
        })
      : null;
  const status = value.status;
  if (
    status !== "pending" &&
    status !== "retry" &&
    status !== "processing" &&
    status !== "sent" &&
    status !== "dead"
  ) {
    return null;
  }

  return {
    id: value.id,
    accountKey: value.account_key,
    payload: {
      chatId: payload.chatId,
      text: payload.text,
      options: {
        ...(typeof options.messageThreadId === "number"
          ? { messageThreadId: Math.floor(options.messageThreadId) }
          : {}),
        ...(typeof options.replyToMessageId === "number"
          ? { replyToMessageId: Math.floor(options.replyToMessageId) }
          : {}),
      },
      ...(ttsPayload !== null &&
      (ttsPayload.mode === "text_and_voice" || ttsPayload.mode === "voice_only")
        ? {
            tts: {
              mode: ttsPayload.mode,
              ...(typeof ttsPayload.voiceId === "string" && ttsPayload.voiceId.trim().length > 0
                ? { voiceId: ttsPayload.voiceId.trim() }
                : {}),
              ...(typeof ttsPayload.modelId === "string" && ttsPayload.modelId.trim().length > 0
                ? { modelId: ttsPayload.modelId.trim() }
                : {}),
              ...(typeof ttsPayload.outputFormat === "string" &&
              ttsPayload.outputFormat.trim().length > 0
                ? { outputFormat: ttsPayload.outputFormat.trim() }
                : {}),
            },
          }
        : {}),
      ...(typeof payload.updateId === "number" ? { updateId: Math.floor(payload.updateId) } : {}),
    },
    status,
    attempts: value.attempts,
    availableAtMs: value.available_at_ms,
    lastError: value.last_error,
    createdAtMs: value.created_at_ms,
    updatedAtMs: value.updated_at_ms,
  };
}

export class InMemoryTelegramOutboxStore implements TelegramOutboxStore {
  private readonly records = new Map<string, TelegramOutboxRecord>();

  public async enqueue(entry: {
    accountKey: string;
    payload: TelegramOutboxPayload;
    availableAtMs: number;
  }): Promise<TelegramOutboxRecord> {
    const now = Date.now();
    const record: TelegramOutboxRecord = {
      id: randomId("outbox"),
      accountKey: entry.accountKey,
      payload: entry.payload,
      status: "pending",
      attempts: 0,
      availableAtMs: entry.availableAtMs,
      lastError: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  public async claimNextReady(nowMs: number): Promise<TelegramOutboxRecord | null> {
    const ready = [...this.records.values()]
      .filter((record) => {
        if (record.status !== "pending" && record.status !== "retry") {
          return false;
        }
        return record.availableAtMs <= nowMs;
      })
      .sort((left, right) => {
        if (left.availableAtMs !== right.availableAtMs) {
          return left.availableAtMs - right.availableAtMs;
        }
        return left.createdAtMs - right.createdAtMs;
      });

    const next = ready[0];
    if (!next) {
      return null;
    }

    const updated: TelegramOutboxRecord = {
      ...next,
      status: "processing",
      updatedAtMs: nowMs,
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  public async markSent(params: { id: string; nowMs: number }): Promise<void> {
    const record = this.records.get(params.id);
    if (!record) {
      return;
    }
    this.records.set(params.id, {
      ...record,
      status: "sent",
      lastError: null,
      updatedAtMs: params.nowMs,
    });
  }

  public async markRetry(params: {
    id: string;
    nowMs: number;
    attempts: number;
    availableAtMs: number;
    errorMessage: string;
  }): Promise<void> {
    const record = this.records.get(params.id);
    if (!record) {
      return;
    }
    this.records.set(params.id, {
      ...record,
      status: "retry",
      attempts: params.attempts,
      availableAtMs: params.availableAtMs,
      lastError: params.errorMessage,
      updatedAtMs: params.nowMs,
    });
  }

  public async markDead(params: {
    id: string;
    nowMs: number;
    attempts: number;
    errorMessage: string;
  }): Promise<void> {
    const record = this.records.get(params.id);
    if (!record) {
      return;
    }
    this.records.set(params.id, {
      ...record,
      status: "dead",
      attempts: params.attempts,
      lastError: params.errorMessage,
      updatedAtMs: params.nowMs,
    });
  }

  public async releaseClaim(params: { id: string; nowMs: number }): Promise<void> {
    const record = this.records.get(params.id);
    if (!record || record.status !== "processing") {
      return;
    }
    this.records.set(params.id, {
      ...record,
      status: "retry",
      availableAtMs: params.nowMs,
      updatedAtMs: params.nowMs,
    });
  }

  public async recoverStuckProcessing(nowMs: number): Promise<number> {
    let recovered = 0;
    for (const record of this.records.values()) {
      if (record.status !== "processing") {
        continue;
      }
      recovered += 1;
      this.records.set(record.id, {
        ...record,
        status: "retry",
        availableAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    }
    return recovered;
  }

  public async stats(): Promise<TelegramOutboxStats> {
    const stats: TelegramOutboxStats = {
      pending: 0,
      retry: 0,
      processing: 0,
      sent: 0,
      dead: 0,
    };

    for (const record of this.records.values()) {
      stats[record.status] += 1;
    }

    return stats;
  }

  public async listDead(limit: number): Promise<TelegramOutboxRecord[]> {
    const capped = clampLimit(limit);
    return [...this.records.values()]
      .filter((record) => record.status === "dead")
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, capped);
  }

  public async close(): Promise<void> {
    return;
  }
}

export class PostgresTelegramOutboxStore implements TelegramOutboxStore {
  private readonly client: PostgresStorageClient;

  private readonly ownsClient: boolean;

  private readonly ready: Promise<void>;

  public constructor(params: {
    client?: PostgresStorageClient;
    databaseUrl?: string;
  } = {}) {
    if (params.client !== undefined) {
      this.client = params.client;
      this.ownsClient = false;
    } else {
      this.client = createPostgresStorageClient(params.databaseUrl ?? resolveDatabaseUrl());
      this.ownsClient = true;
    }
    this.ready = this.ensureSchema();
  }

  public async enqueue(entry: {
    accountKey: string;
    payload: TelegramOutboxPayload;
    availableAtMs: number;
  }): Promise<TelegramOutboxRecord> {
    await this.ready;
    const nowMs = Date.now();
    const id = randomId("outbox");
    const rows = await this.client.sql<
      Array<{
        id: string;
        account_key: string;
        payload: unknown;
        status: string;
        attempts: number;
        available_at_ms: number;
        last_error: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>
    >`
      insert into telegram_outbox (
        id,
        account_key,
        payload,
        status,
        attempts,
        available_at_ms,
        last_error,
        created_at_ms,
        updated_at_ms
      )
      values (
        ${id},
        ${entry.accountKey},
        ${JSON.stringify(entry.payload)}::jsonb,
        'pending',
        0,
        ${entry.availableAtMs},
        null,
        ${nowMs},
        ${nowMs}
      )
      returning id, account_key, payload, status, attempts, available_at_ms, last_error, created_at_ms, updated_at_ms
    `;

    const row = rows[0];
    const parsed = row ? toRecord(row) : null;
    if (!parsed) {
      throw new Error("failed to enqueue telegram outbox record");
    }
    return parsed;
  }

  public async claimNextReady(nowMs: number): Promise<TelegramOutboxRecord | null> {
    await this.ready;
    const rows = await this.client.sql<
      Array<{
        id: string;
        account_key: string;
        payload: unknown;
        status: string;
        attempts: number;
        available_at_ms: number;
        last_error: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>
    >`
      with candidate as (
        select id
        from telegram_outbox
        where status in ('pending', 'retry')
          and available_at_ms <= ${nowMs}
        order by available_at_ms asc, created_at_ms asc
        limit 1
        for update skip locked
      )
      update telegram_outbox as target
      set status = 'processing',
          updated_at_ms = ${nowMs}
      from candidate
      where target.id = candidate.id
      returning target.id, target.account_key, target.payload, target.status, target.attempts, target.available_at_ms, target.last_error, target.created_at_ms, target.updated_at_ms
    `;

    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  public async markSent(params: { id: string; nowMs: number }): Promise<void> {
    await this.ready;
    await this.client.sql`
      update telegram_outbox
      set status = 'sent',
          last_error = null,
          updated_at_ms = ${params.nowMs}
      where id = ${params.id}
    `;
  }

  public async markRetry(params: {
    id: string;
    nowMs: number;
    attempts: number;
    availableAtMs: number;
    errorMessage: string;
  }): Promise<void> {
    await this.ready;
    await this.client.sql`
      update telegram_outbox
      set status = 'retry',
          attempts = ${params.attempts},
          available_at_ms = ${params.availableAtMs},
          last_error = ${params.errorMessage},
          updated_at_ms = ${params.nowMs}
      where id = ${params.id}
    `;
  }

  public async markDead(params: {
    id: string;
    nowMs: number;
    attempts: number;
    errorMessage: string;
  }): Promise<void> {
    await this.ready;
    await this.client.sql`
      update telegram_outbox
      set status = 'dead',
          attempts = ${params.attempts},
          last_error = ${params.errorMessage},
          updated_at_ms = ${params.nowMs}
      where id = ${params.id}
    `;
  }

  public async releaseClaim(params: { id: string; nowMs: number }): Promise<void> {
    await this.ready;
    await this.client.sql`
      update telegram_outbox
      set status = 'retry',
          available_at_ms = ${params.nowMs},
          updated_at_ms = ${params.nowMs}
      where id = ${params.id}
        and status = 'processing'
    `;
  }

  public async recoverStuckProcessing(nowMs: number): Promise<number> {
    await this.ready;
    const rows = await this.client.sql<Array<{ id: string }>>`
      update telegram_outbox
      set status = 'retry',
          available_at_ms = ${nowMs},
          updated_at_ms = ${nowMs}
      where status = 'processing'
      returning id
    `;
    return rows.length;
  }

  public async stats(): Promise<TelegramOutboxStats> {
    await this.ready;
    const rows = await this.client.sql<Array<{ status: string; count: number }>>`
      select status, count(*)::int as count
      from telegram_outbox
      group by status
    `;

    const stats: TelegramOutboxStats = {
      pending: 0,
      retry: 0,
      processing: 0,
      sent: 0,
      dead: 0,
    };

    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof TelegramOutboxStats] = row.count;
      }
    }

    return stats;
  }

  public async listDead(limit: number): Promise<TelegramOutboxRecord[]> {
    await this.ready;
    const capped = clampLimit(limit);
    const rows = await this.client.sql<
      Array<{
        id: string;
        account_key: string;
        payload: unknown;
        status: string;
        attempts: number;
        available_at_ms: number;
        last_error: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>
    >`
      select id, account_key, payload, status, attempts, available_at_ms, last_error, created_at_ms, updated_at_ms
      from telegram_outbox
      where status = 'dead'
      order by updated_at_ms desc
      limit ${capped}
    `;

    return rows.map((row) => toRecord(row)).filter((row): row is TelegramOutboxRecord => row !== null);
  }

  public async close(): Promise<void> {
    if (!this.ownsClient) {
      return;
    }
    await this.client.close();
  }

  private async ensureSchema(): Promise<void> {
    await this.client.sql`
      create table if not exists telegram_outbox (
        id text primary key,
        account_key text not null,
        payload jsonb not null,
        status text not null,
        attempts integer not null,
        available_at_ms bigint not null,
        last_error text,
        created_at_ms bigint not null,
        updated_at_ms bigint not null
      )
    `;
    await this.client.sql`
      create index if not exists telegram_outbox_claim_idx
      on telegram_outbox (status, available_at_ms, created_at_ms)
    `;
    await this.client.sql`
      create index if not exists telegram_outbox_account_idx
      on telegram_outbox (account_key, created_at_ms)
    `;
  }
}

export function createOutboxStoreFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramOutboxStore {
  const rawMode = env.JIHN_TELEGRAM_OUTBOX_BACKEND?.trim().toLowerCase();
  if (rawMode === "postgres") {
    return new PostgresTelegramOutboxStore({
      ...(env.JIHN_DATABASE_URL?.trim()
        ? {
            databaseUrl: env.JIHN_DATABASE_URL.trim(),
          }
        : {}),
    });
  }
  return new InMemoryTelegramOutboxStore();
}

export function formatOutboxError(error: unknown): string {
  return toErrorMessage(error);
}

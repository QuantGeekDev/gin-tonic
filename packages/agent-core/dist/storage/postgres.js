import { and, asc, desc, eq, sql } from "drizzle-orm";
import { MemoryStore } from "../memory/store.js";
import { McpServerStore } from "../mcp/store.js";
import { SessionStore } from "../sessions/store.js";
import { gatewayIdempotency, gatewaySessionLocks, mcpServers, memories, sessionMessages, } from "../db/schema.js";
const SCHEMA_LOCK_CLASS_ID = 2147483000;
const SCHEMA_LOCK_OBJECT_ID = 17;
const schemaInitByClient = new WeakMap();
function splitTerms(value) {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length > 0);
}
function scoreMemoryRecord(record, queryTerms) {
    const text = record.text.toLowerCase();
    const tagText = record.tags.join(" ").toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        if (text.includes(term)) {
            score += 3;
        }
        if (tagText.includes(term)) {
            score += 5;
        }
    }
    return score;
}
function dot(left, right) {
    const size = Math.min(left.length, right.length);
    let value = 0;
    for (let index = 0; index < size; index += 1) {
        value += (left[index] ?? 0) * (right[index] ?? 0);
    }
    return value;
}
function norm(values) {
    let sum = 0;
    for (const value of values) {
        sum += value * value;
    }
    return Math.sqrt(sum);
}
function cosineSimilarity(left, right) {
    if (left === undefined || right === undefined || left.length === 0 || right.length === 0) {
        return 0;
    }
    const denominator = norm(left) * norm(right);
    if (denominator <= 0) {
        return 0;
    }
    return dot(left, right) / denominator;
}
function normalizeTags(tags) {
    if (tags === undefined) {
        return [];
    }
    return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}
function sanitizeNamespace(value) {
    const normalized = (value ?? "global")
        .trim()
        .replace(/[^a-zA-Z0-9._:-]+/g, "_");
    return normalized.length > 0 ? normalized : "global";
}
function isMessage(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value;
    const validRole = candidate.role === "user" || candidate.role === "assistant";
    const validContent = typeof candidate.content === "string" || Array.isArray(candidate.content);
    return validRole && validContent;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeMcpServerConfig(value) {
    if (!isRecord(value)) {
        return null;
    }
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (id.length === 0 || url.length === 0) {
        return null;
    }
    const config = {
        id,
        url,
    };
    if (typeof value.name === "string" && value.name.trim().length > 0) {
        config.name = value.name.trim();
    }
    if (typeof value.enabled === "boolean") {
        config.enabled = value.enabled;
    }
    if (typeof value.requestTimeoutMs === "number" && Number.isFinite(value.requestTimeoutMs)) {
        config.requestTimeoutMs = Math.floor(value.requestTimeoutMs);
    }
    if (typeof value.sessionId === "string" && value.sessionId.trim().length > 0) {
        config.sessionId = value.sessionId.trim();
    }
    if (isRecord(value.headers)) {
        const headers = Object.entries(value.headers)
            .filter((entry) => typeof entry[1] === "string")
            .map(([key, headerValue]) => [key.trim(), headerValue.trim()])
            .filter(([key, headerValue]) => key.length > 0 && headerValue.length > 0);
        if (headers.length > 0) {
            config.headers = Object.fromEntries(headers);
        }
    }
    if (isRecord(value.auth) && typeof value.auth.mode === "string") {
        if (value.auth.mode === "none") {
            config.auth = { mode: "none" };
        }
        if (value.auth.mode === "bearer" && typeof value.auth.token === "string") {
            config.auth = { mode: "bearer", token: value.auth.token };
        }
        if (value.auth.mode === "oauth2" && isRecord(value.auth.oauth)) {
            const oauth = value.auth.oauth;
            config.auth = {
                mode: "oauth2",
                oauth: {
                    ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
                    ...(typeof oauth.clientId === "string" ? { clientId: oauth.clientId } : {}),
                    ...(typeof oauth.clientSecret === "string" ? { clientSecret: oauth.clientSecret } : {}),
                    ...(typeof oauth.accessToken === "string" ? { accessToken: oauth.accessToken } : {}),
                    ...(typeof oauth.tokenType === "string" ? { tokenType: oauth.tokenType } : {}),
                    ...(typeof oauth.refreshToken === "string" ? { refreshToken: oauth.refreshToken } : {}),
                    ...(typeof oauth.expiresAt === "string" ? { expiresAt: oauth.expiresAt } : {}),
                    ...(typeof oauth.redirectUrl === "string" ? { redirectUrl: oauth.redirectUrl } : {}),
                    ...(typeof oauth.pendingState === "string" ? { pendingState: oauth.pendingState } : {}),
                    ...(typeof oauth.codeVerifier === "string" ? { codeVerifier: oauth.codeVerifier } : {}),
                    ...(typeof oauth.lastAuthorizationUrl === "string"
                        ? { lastAuthorizationUrl: oauth.lastAuthorizationUrl }
                        : {}),
                },
            };
        }
    }
    return config;
}
function normalizeMcpServerInput(input) {
    return {
        id: input.id.trim(),
        url: input.url.trim(),
        ...(typeof input.name === "string" && input.name.trim().length > 0
            ? { name: input.name.trim() }
            : {}),
        ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        ...(input.requestTimeoutMs !== undefined
            ? { requestTimeoutMs: Math.floor(input.requestTimeoutMs) }
            : {}),
        ...(input.auth !== undefined ? { auth: input.auth } : {}),
    };
}
export async function ensurePostgresSchema(client) {
    const existing = schemaInitByClient.get(client);
    if (existing !== undefined) {
        await existing;
        return;
    }
    const initialize = (async () => {
        await client.sql `select pg_advisory_lock(${SCHEMA_LOCK_CLASS_ID}, ${SCHEMA_LOCK_OBJECT_ID})`;
        try {
            await client.sql `
        create table if not exists session_messages (
          session_key text not null,
          message_index integer not null,
          message jsonb not null,
          created_at timestamptz not null default now(),
          constraint session_messages_pk primary key (session_key, message_index)
        )
      `;
            await client.sql `
        create table if not exists memories (
          id text primary key,
          namespace text not null,
          text text not null,
          tags jsonb not null,
          embedding jsonb,
          created_at timestamptz not null default now()
        )
      `;
            await client.sql `alter table memories add column if not exists embedding jsonb`;
            await client.sql `
        create table if not exists mcp_servers (
          id text primary key,
          config jsonb not null,
          updated_at timestamptz not null default now()
        )
      `;
            await client.sql `
        create table if not exists gateway_idempotency (
          session_key text not null,
          idempotency_key text not null,
          fingerprint text not null,
          result jsonb not null,
          created_at_ms bigint not null,
          constraint gateway_idempotency_pk primary key (session_key, idempotency_key)
        )
      `;
            await client.sql `
        create table if not exists gateway_session_locks (
          session_key text primary key,
          updated_at timestamptz not null default now()
        )
      `;
        }
        finally {
            await client.sql `select pg_advisory_unlock(${SCHEMA_LOCK_CLASS_ID}, ${SCHEMA_LOCK_OBJECT_ID})`;
        }
    })();
    schemaInitByClient.set(client, initialize);
    try {
        await initialize;
    }
    catch (error) {
        schemaInitByClient.delete(client);
        throw error;
    }
}
export class PostgresSessionStore extends SessionStore {
    client;
    ready;
    constructor(client) {
        super(".");
        this.client = client;
        this.ready = ensurePostgresSchema(client);
    }
    async load(sessionKey) {
        await this.ready;
        const rows = await this.client.db
            .select({ message: sessionMessages.message })
            .from(sessionMessages)
            .where(eq(sessionMessages.sessionKey, sessionKey))
            .orderBy(asc(sessionMessages.messageIndex));
        return rows
            .map((row) => row.message)
            .filter((value) => isMessage(value));
    }
    async append(sessionKey, message) {
        await this.ready;
        await this.client.db.transaction(async (tx) => {
            const rows = await tx
                .select({ maxIndex: sql `coalesce(max(${sessionMessages.messageIndex}), -1)` })
                .from(sessionMessages)
                .where(eq(sessionMessages.sessionKey, sessionKey));
            const maxIndex = rows[0]?.maxIndex ?? -1;
            const nextIndex = maxIndex + 1;
            await tx.insert(sessionMessages).values({
                sessionKey,
                messageIndex: nextIndex,
                message,
            });
        });
    }
    async save(sessionKey, messages) {
        await this.ready;
        await this.client.db.transaction(async (tx) => {
            await tx.delete(sessionMessages).where(eq(sessionMessages.sessionKey, sessionKey));
            if (messages.length === 0) {
                return;
            }
            await tx.insert(sessionMessages).values(messages.map((message, index) => ({
                sessionKey,
                messageIndex: index,
                message,
            })));
        });
    }
}
export class PostgresMemoryStore extends MemoryStore {
    client;
    embeddingProvider;
    ready;
    constructor(client, embeddingProvider) {
        super(".", { embeddingProvider });
        this.client = client;
        this.embeddingProvider = embeddingProvider;
        this.ready = ensurePostgresSchema(client);
    }
    async saveMemory(input) {
        await this.ready;
        const text = input.text.trim();
        if (text.length === 0) {
            throw new Error("text must be a non-empty string");
        }
        const record = {
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            namespace: sanitizeNamespace(input.namespace),
            text,
            tags: normalizeTags(input.tags),
            createdAt: new Date().toISOString(),
        };
        const embedding = this.embeddingProvider !== undefined
            ? await this.embeddingProvider.embed(record.text)
            : undefined;
        await this.client.db.insert(memories).values({
            id: record.id,
            namespace: record.namespace,
            text: record.text,
            tags: record.tags,
            ...(embedding !== undefined ? { embedding } : {}),
            createdAt: new Date(record.createdAt),
        });
        return record;
    }
    async searchMemory(input) {
        await this.ready;
        const query = input.query.trim();
        if (query.length === 0) {
            return [];
        }
        const queryTerms = splitTerms(query);
        const namespace = input.namespace?.trim();
        const limit = Math.max(1, Math.min(50, input.limit ?? 10));
        const queryEmbedding = this.embeddingProvider !== undefined
            ? await this.embeddingProvider.embed(query)
            : undefined;
        const rows = namespace && namespace.length > 0
            ? await this.client.db
                .select()
                .from(memories)
                .where(eq(memories.namespace, namespace))
                .orderBy(desc(memories.createdAt))
            : await this.client.db.select().from(memories).orderBy(desc(memories.createdAt));
        const ranked = rows
            .map((row) => {
            const tags = Array.isArray(row.tags)
                ? row.tags.filter((tag) => typeof tag === "string")
                : [];
            const lexicalScore = scoreMemoryRecord({
                text: row.text,
                tags,
            }, queryTerms);
            const rowEmbedding = Array.isArray(row.embedding) &&
                row.embedding.every((value) => typeof value === "number")
                ? row.embedding
                : undefined;
            const semanticScore = Math.max(0, cosineSimilarity(rowEmbedding, queryEmbedding)) * 10;
            const score = lexicalScore + semanticScore;
            return {
                id: row.id,
                namespace: row.namespace,
                text: row.text,
                tags,
                createdAt: row.createdAt.toISOString(),
                score,
            };
        })
            .filter((row) => row.score > 0)
            .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return right.createdAt.localeCompare(left.createdAt);
        })
            .slice(0, limit);
        return ranked;
    }
    async backfillEmbeddings(limit = 100) {
        await this.ready;
        if (this.embeddingProvider === undefined) {
            return { indexed: 0, skipped: 0 };
        }
        const rows = await this.client.db
            .select({
            id: memories.id,
            text: memories.text,
            embedding: memories.embedding,
        })
            .from(memories)
            .orderBy(desc(memories.createdAt));
        let indexed = 0;
        let skipped = 0;
        for (const row of rows) {
            const hasEmbedding = Array.isArray(row.embedding) &&
                row.embedding.every((value) => typeof value === "number");
            if (hasEmbedding) {
                skipped += 1;
                continue;
            }
            if (indexed >= Math.max(1, Math.floor(limit))) {
                skipped += 1;
                continue;
            }
            const embedding = await this.embeddingProvider.embed(row.text);
            await this.client.db
                .update(memories)
                .set({ embedding })
                .where(eq(memories.id, row.id));
            indexed += 1;
        }
        return { indexed, skipped };
    }
}
export class PostgresMcpServerStore extends McpServerStore {
    client;
    ready;
    constructor(client) {
        super(".");
        this.client = client;
        this.ready = ensurePostgresSchema(client);
    }
    async listServers() {
        await this.ready;
        const rows = await this.client.db
            .select({ config: mcpServers.config })
            .from(mcpServers)
            .orderBy(asc(mcpServers.id));
        return rows
            .map((row) => normalizeMcpServerConfig(row.config))
            .filter((config) => config !== null)
            .sort((left, right) => left.id.localeCompare(right.id));
    }
    async saveServers(servers) {
        await this.ready;
        await this.client.db.transaction(async (tx) => {
            await tx.delete(mcpServers);
            if (servers.length === 0) {
                return;
            }
            await tx.insert(mcpServers).values(servers.map((server) => ({
                id: server.id,
                config: server,
            })));
        });
    }
    async upsertServer(input) {
        await this.ready;
        const next = normalizeMcpServerInput(input);
        await this.client.db
            .insert(mcpServers)
            .values({
            id: next.id,
            config: next,
        })
            .onConflictDoUpdate({
            target: mcpServers.id,
            set: {
                config: next,
                updatedAt: sql `now()`,
            },
        });
        return this.listServers();
    }
    async removeServer(serverId) {
        await this.ready;
        await this.client.db.delete(mcpServers).where(eq(mcpServers.id, serverId));
        return this.listServers();
    }
}
export class PostgresGatewayIdempotencyStore {
    client;
    ttlMs;
    ready;
    constructor(client, ttlMs = 24 * 60 * 60 * 1000) {
        this.client = client;
        this.ttlMs = ttlMs;
        this.ready = ensurePostgresSchema(client);
    }
    async get(sessionKey, idempotencyKey) {
        await this.ready;
        const rows = await this.client.db
            .select({
            fingerprint: gatewayIdempotency.fingerprint,
            result: gatewayIdempotency.result,
            createdAtMs: gatewayIdempotency.createdAtMs,
        })
            .from(gatewayIdempotency)
            .where(and(eq(gatewayIdempotency.sessionKey, sessionKey), eq(gatewayIdempotency.idempotencyKey, idempotencyKey)))
            .limit(1);
        const row = rows[0];
        if (!row) {
            return null;
        }
        if (Date.now() - row.createdAtMs > this.ttlMs) {
            await this.client.db
                .delete(gatewayIdempotency)
                .where(and(eq(gatewayIdempotency.sessionKey, sessionKey), eq(gatewayIdempotency.idempotencyKey, idempotencyKey)));
            return null;
        }
        if (!isRecord(row.result)) {
            return null;
        }
        return {
            fingerprint: row.fingerprint,
            result: row.result,
            createdAtMs: row.createdAtMs,
        };
    }
    async set(sessionKey, idempotencyKey, entry) {
        await this.ready;
        await this.client.db
            .insert(gatewayIdempotency)
            .values({
            sessionKey,
            idempotencyKey,
            fingerprint: entry.fingerprint,
            result: entry.result,
            createdAtMs: entry.createdAtMs,
        })
            .onConflictDoUpdate({
            target: [gatewayIdempotency.sessionKey, gatewayIdempotency.idempotencyKey],
            set: {
                fingerprint: entry.fingerprint,
                result: entry.result,
                createdAtMs: entry.createdAtMs,
            },
        });
    }
}
export class PostgresSessionLockManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async runExclusive(sessionKey, task) {
        await ensurePostgresSchema(this.client);
        return this.client.db.transaction(async (tx) => {
            await tx
                .insert(gatewaySessionLocks)
                .values({
                sessionKey,
            })
                .onConflictDoNothing();
            await tx.execute(sql `select session_key from gateway_session_locks where session_key = ${sessionKey} for update`);
            return task();
        });
    }
}
//# sourceMappingURL=postgres.js.map
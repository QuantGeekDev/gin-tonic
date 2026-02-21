import { MemoryStore, type MemorySearchInput, type MemorySearchResult, type SavedMemory, type SaveMemoryInput } from "../memory/store.js";
import type { MemoryEmbeddingProvider } from "../memory/embeddings.js";
import { McpServerStore } from "../mcp/store.js";
import type { McpServerConfig, McpServerInput } from "../mcp/types.js";
import { SessionStore } from "../sessions/store.js";
import type { Message } from "../types/message.js";
import type { PostgresStorageClient } from "../db/client.js";
import type { GatewayIdempotencyStore, SessionLockManager } from "../gateway/hardening.js";
import type { HandleMessageResult } from "../gateway/handle-message.js";
export declare function ensurePostgresSchema(client: PostgresStorageClient): Promise<void>;
export declare class PostgresSessionStore extends SessionStore {
    private readonly client;
    private readonly ready;
    constructor(client: PostgresStorageClient);
    load(sessionKey: string): Promise<Message[]>;
    append(sessionKey: string, message: Message): Promise<void>;
    save(sessionKey: string, messages: Message[]): Promise<void>;
}
export declare class PostgresMemoryStore extends MemoryStore {
    private readonly client;
    protected readonly embeddingProvider: MemoryEmbeddingProvider | undefined;
    private readonly ready;
    constructor(client: PostgresStorageClient, embeddingProvider?: MemoryEmbeddingProvider);
    saveMemory(input: SaveMemoryInput): Promise<SavedMemory>;
    searchMemory(input: MemorySearchInput): Promise<MemorySearchResult[]>;
    backfillEmbeddings(limit?: number): Promise<{
        indexed: number;
        skipped: number;
    }>;
}
export declare class PostgresMcpServerStore extends McpServerStore {
    private readonly client;
    private readonly ready;
    constructor(client: PostgresStorageClient);
    listServers(): Promise<McpServerConfig[]>;
    saveServers(servers: McpServerConfig[]): Promise<void>;
    upsertServer(input: McpServerInput): Promise<McpServerConfig[]>;
    removeServer(serverId: string): Promise<McpServerConfig[]>;
}
interface IdempotencyEntry {
    fingerprint: string;
    result: HandleMessageResult;
    createdAtMs: number;
}
export declare class PostgresGatewayIdempotencyStore implements GatewayIdempotencyStore {
    private readonly client;
    private readonly ttlMs;
    private readonly ready;
    constructor(client: PostgresStorageClient, ttlMs?: number);
    get(sessionKey: string, idempotencyKey: string): Promise<IdempotencyEntry | null>;
    set(sessionKey: string, idempotencyKey: string, entry: IdempotencyEntry): Promise<void>;
}
export declare class PostgresSessionLockManager implements SessionLockManager {
    private readonly client;
    constructor(client: PostgresStorageClient);
    runExclusive<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
}
export {};
//# sourceMappingURL=postgres.d.ts.map
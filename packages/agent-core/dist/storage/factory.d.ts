import { MemoryStore } from "../memory/store.js";
import { McpServerStore } from "../mcp/store.js";
import { SessionStore } from "../sessions/store.js";
import { type PostgresStorageClient } from "../db/client.js";
import { type StorageBackend } from "./config.js";
import type { GatewayIdempotencyStore, SessionLockManager } from "../gateway/hardening.js";
export interface StorageRuntime {
    backend: StorageBackend;
    sessionStore: SessionStore;
    memoryStore: MemoryStore;
    mcpStore: McpServerStore;
    idempotencyStore?: GatewayIdempotencyStore;
    lockManager?: SessionLockManager;
    postgresClient?: PostgresStorageClient;
}
export interface CreateStorageRuntimeOptions {
    env?: NodeJS.ProcessEnv;
    defaultMcpStorePath: string;
}
export declare function createStorageRuntime(options: CreateStorageRuntimeOptions): StorageRuntime;
//# sourceMappingURL=factory.d.ts.map
import { MemoryStore } from "../memory/store.js";
import { resolveMemoryEmbeddingProviderFromEnv } from "../memory/embeddings.js";
import { McpServerStore } from "../mcp/store.js";
import { SessionStore } from "../sessions/store.js";
import { createPostgresStorageClient, resolveDatabaseUrl, } from "../db/client.js";
import { PostgresGatewayIdempotencyStore, PostgresMcpServerStore, PostgresMemoryStore, PostgresSessionLockManager, PostgresSessionStore, } from "./postgres.js";
import { resolveStorageBackend } from "./config.js";
export function createStorageRuntime(options) {
    const env = options.env ?? process.env;
    const backend = resolveStorageBackend(env);
    const embeddingProvider = resolveMemoryEmbeddingProviderFromEnv(env);
    if (backend === "postgres") {
        const databaseUrl = resolveDatabaseUrl(env);
        const postgresClient = createPostgresStorageClient(databaseUrl);
        return {
            backend,
            postgresClient,
            sessionStore: new PostgresSessionStore(postgresClient),
            memoryStore: new PostgresMemoryStore(postgresClient, embeddingProvider),
            mcpStore: new PostgresMcpServerStore(postgresClient),
            idempotencyStore: new PostgresGatewayIdempotencyStore(postgresClient),
            lockManager: new PostgresSessionLockManager(postgresClient),
        };
    }
    return {
        backend,
        sessionStore: new SessionStore(),
        memoryStore: new MemoryStore(undefined, { embeddingProvider }),
        mcpStore: new McpServerStore(options.defaultMcpStorePath),
    };
}
//# sourceMappingURL=factory.js.map
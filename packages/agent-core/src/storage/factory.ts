import { MemoryStore } from "../memory/store.js";
import { resolveMemoryEmbeddingProviderFromEnv } from "../memory/embeddings.js";
import { McpServerStore } from "../mcp/store.js";
import { SessionStore } from "../sessions/store.js";
import {
  createPostgresStorageClient,
  resolveDatabaseUrl,
  type PostgresStorageClient,
} from "../db/client.js";
import {
  PostgresGatewayIdempotencyStore,
  PostgresMcpServerStore,
  PostgresMemoryStore,
  PostgresSessionLockManager,
  PostgresSessionStore,
} from "./postgres.js";
import { resolveStorageBackend, type StorageBackend } from "./config.js";
import type {
  GatewayIdempotencyStore,
  SessionLockManager,
} from "../gateway/hardening.js";

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

export function createStorageRuntime(
  options: CreateStorageRuntimeOptions,
): StorageRuntime {
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

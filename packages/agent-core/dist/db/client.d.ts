import { type Sql } from "postgres";
import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
export interface PostgresStorageClient {
    sql: Sql;
    db: PostgresJsDatabase<typeof schema>;
    close(): Promise<void>;
}
export declare function resolveDatabaseUrl(env?: NodeJS.ProcessEnv): string;
export declare function createPostgresStorageClient(databaseUrl: string): PostgresStorageClient;
export declare function getSharedPostgresStorageClient(databaseUrl?: string): PostgresStorageClient;
//# sourceMappingURL=client.d.ts.map
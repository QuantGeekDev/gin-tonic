import postgres, {} from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";
import * as schema from "./schema.js";
let sharedClient = null;
export function resolveDatabaseUrl(env = process.env) {
    const parsed = z
        .object({
        JIHN_DATABASE_URL: z.string().optional(),
        DATABASE_URL: z.string().optional(),
    })
        .parse(env);
    const fromJihn = parsed.JIHN_DATABASE_URL?.trim();
    if (fromJihn && fromJihn.length > 0) {
        return fromJihn;
    }
    const fromDefault = parsed.DATABASE_URL?.trim();
    if (fromDefault && fromDefault.length > 0) {
        return fromDefault;
    }
    throw new Error("DATABASE_URL (or JIHN_DATABASE_URL) is required for postgres backend");
}
export function createPostgresStorageClient(databaseUrl) {
    const sql = postgres(databaseUrl, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
    });
    const db = drizzle(sql, { schema });
    return {
        sql,
        db,
        async close() {
            await sql.end({ timeout: 5 });
        },
    };
}
export function getSharedPostgresStorageClient(databaseUrl = resolveDatabaseUrl()) {
    if (sharedClient !== null) {
        return sharedClient;
    }
    sharedClient = createPostgresStorageClient(databaseUrl);
    return sharedClient;
}
//# sourceMappingURL=client.js.map
import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, } from "drizzle-orm/pg-core";
export const sessionMessages = pgTable("session_messages", {
    sessionKey: text("session_key").notNull(),
    messageIndex: integer("message_index").notNull(),
    message: jsonb("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    pk: primaryKey({
        columns: [table.sessionKey, table.messageIndex],
        name: "session_messages_pk",
    }),
}));
export const memories = pgTable("memories", {
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    text: text("text").notNull(),
    tags: jsonb("tags").notNull(),
    embedding: jsonb("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const mcpServers = pgTable("mcp_servers", {
    id: text("id").primaryKey(),
    config: jsonb("config").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const gatewayIdempotency = pgTable("gateway_idempotency", {
    sessionKey: text("session_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: jsonb("result").notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => ({
    pk: primaryKey({
        columns: [table.sessionKey, table.idempotencyKey],
        name: "gateway_idempotency_pk",
    }),
}));
export const gatewaySessionLocks = pgTable("gateway_session_locks", {
    sessionKey: text("session_key").primaryKey(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
//# sourceMappingURL=schema.js.map
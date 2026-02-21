import { z } from "zod";
const mcpServerEntrySchema = z
    .object({
    id: z.string().optional(),
    url: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    requestTimeoutMs: z.number().finite().positive().optional(),
    sessionId: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
})
    .strict();
function sanitizeId(rawId) {
    const normalized = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    return normalized.length > 0 ? normalized : "mcp";
}
function normalizeHeaders(value) {
    if (value === undefined) {
        return undefined;
    }
    const entries = Object.entries(value)
        .map(([key, headerValue]) => [key.trim(), headerValue.trim()])
        .filter(([key, headerValue]) => key.length > 0 && headerValue.length > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
export function parseMcpServersFromEnv(rawValue) {
    if (rawValue === undefined || rawValue.trim().length === 0) {
        return [];
    }
    const json = z.string().transform((value, ctx) => {
        try {
            return JSON.parse(value);
        }
        catch {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid MCP server JSON",
            });
            return z.NEVER;
        }
    });
    const parsedJson = json.safeParse(rawValue);
    if (!parsedJson.success || !Array.isArray(parsedJson.data)) {
        return [];
    }
    const results = [];
    for (let index = 0; index < parsedJson.data.length; index += 1) {
        const entry = parsedJson.data[index];
        const parsedEntry = mcpServerEntrySchema.safeParse(entry);
        if (!parsedEntry.success) {
            continue;
        }
        const value = parsedEntry.data;
        const rawId = value.id !== undefined && value.id.trim().length > 0
            ? value.id
            : `mcp-${index + 1}`;
        const timeoutMs = value.requestTimeoutMs !== undefined
            ? Math.floor(value.requestTimeoutMs)
            : undefined;
        const sessionId = value.sessionId?.trim();
        const headers = normalizeHeaders(value.headers);
        results.push({
            id: sanitizeId(rawId),
            url: value.url.trim(),
            ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
            ...(timeoutMs !== undefined ? { requestTimeoutMs: timeoutMs } : {}),
            ...(sessionId && sessionId.length > 0 ? { sessionId } : {}),
            ...(headers !== undefined ? { headers } : {}),
        });
    }
    return results;
}
//# sourceMappingURL=config.js.map
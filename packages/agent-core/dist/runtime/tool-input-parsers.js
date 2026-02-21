import { z } from "zod";
const objectInputSchema = z.record(z.string(), z.unknown());
const calculateInputSchema = z
    .object({
    expression: z
        .string({ error: "Field 'expression' must be a string." })
        .trim()
        .min(1, "Field 'expression' cannot be empty.")
        .regex(/^[0-9+\-*/().\s]+$/, "Expression contains unsupported characters."),
})
    .strict();
const saveMemoryInputSchema = z
    .object({
    text: z
        .string({ error: "Field 'text' must be a non-empty string." })
        .trim()
        .min(1, "Field 'text' must be a non-empty string."),
    namespace: z.string({ error: "Field 'namespace' must be a string when provided." }).optional(),
    tags: z.array(z.string()).optional(),
})
    .strict();
const memorySearchInputSchema = z
    .object({
    query: z
        .string({ error: "Field 'query' must be a non-empty string." })
        .trim()
        .min(1, "Field 'query' must be a non-empty string."),
    namespace: z.string({ error: "Field 'namespace' must be a string when provided." }).optional(),
    limit: z.number().int().min(1).max(50).optional(),
})
    .strict();
const webSearchInputSchema = z
    .object({
    query: z
        .string({ error: "Field 'query' must be a non-empty string." })
        .trim()
        .min(1, "Field 'query' must be a non-empty string."),
    limit: z.number().int().min(1).max(8).optional(),
    site: z
        .string({ error: "Field 'site' must be a non-empty domain string when provided." })
        .trim()
        .min(1)
        .optional(),
})
    .strict();
const webFetchInputSchema = z
    .object({
    url: z
        .string({ error: "Field 'url' must be a valid absolute URL." })
        .trim()
        .url("Field 'url' must be a valid absolute URL."),
    maxChars: z.number().int().min(200).max(20_000).optional(),
})
    .strict();
function parseObjectInput(input) {
    const parsed = objectInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error("Expected an object input.");
    }
    return parsed.data;
}
function parseWithSchema(input, schema) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid tool input.");
    }
    return parsed.data;
}
export function parseEmptyObjectInput(input) {
    if (input === undefined || input === null) {
        return;
    }
    parseObjectInput(input);
}
export function parseCalculateInput(input) {
    return parseWithSchema(input, calculateInputSchema);
}
export function parseSaveMemoryInput(input) {
    const value = parseWithSchema(input, saveMemoryInputSchema);
    return {
        text: value.text,
        ...(value.namespace !== undefined ? { namespace: value.namespace } : {}),
        ...(value.tags !== undefined ? { tags: value.tags } : {}),
    };
}
export function parseMemorySearchInput(input) {
    const value = parseWithSchema(input, memorySearchInputSchema);
    return {
        query: value.query,
        ...(value.namespace !== undefined ? { namespace: value.namespace } : {}),
        ...(value.limit !== undefined ? { limit: value.limit } : {}),
    };
}
export function parseWebSearchInput(input) {
    const value = parseWithSchema(input, webSearchInputSchema);
    return {
        query: value.query,
        ...(value.limit !== undefined ? { limit: value.limit } : {}),
        ...(value.site !== undefined ? { site: value.site } : {}),
    };
}
export function parseWebFetchInput(input) {
    const value = parseWithSchema(input, webFetchInputSchema);
    return {
        url: value.url,
        ...(value.maxChars !== undefined ? { maxChars: value.maxChars } : {}),
    };
}
//# sourceMappingURL=tool-input-parsers.js.map
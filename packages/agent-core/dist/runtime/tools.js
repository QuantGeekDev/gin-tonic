import { MemoryStore } from "../memory/store.js";
import { CALCULATE_TOOL, CURRENT_TIME_TOOL, MEMORY_SEARCH_TOOL, SAVE_MEMORY_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL, } from "./tool-definitions.js";
import { createDefaultWebSearchClient } from "./web-search.js";
import { evaluateExpression } from "./expression-evaluator.js";
import { parseCalculateInput, parseEmptyObjectInput, parseMemorySearchInput, parseSaveMemoryInput, parseWebFetchInput, parseWebSearchInput, } from "./tool-input-parsers.js";
export function createSharedToolRuntime(options = {}) {
    const memoryStore = options.memoryStore ?? new MemoryStore();
    const now = options.now ?? (() => new Date());
    const pluginRuntime = options.pluginRuntime;
    const webSearchClient = options.webSearchClient ?? createDefaultWebSearchClient();
    const definitions = [
        CURRENT_TIME_TOOL,
        CALCULATE_TOOL,
        SAVE_MEMORY_TOOL,
        MEMORY_SEARCH_TOOL,
        WEB_SEARCH_TOOL,
        WEB_FETCH_TOOL,
        ...(pluginRuntime?.getToolDefinitions() ?? []),
    ];
    return {
        definitions,
        async execute(name, input) {
            if (pluginRuntime?.hasTool(name)) {
                return pluginRuntime.executeTool(name, input);
            }
            switch (name) {
                case "current_time": {
                    parseEmptyObjectInput(input);
                    return now().toISOString();
                }
                case "calculate": {
                    const parsed = parseCalculateInput(input);
                    return String(evaluateExpression(parsed.expression));
                }
                case "save_memory": {
                    const parsed = parseSaveMemoryInput(input);
                    const saved = await memoryStore.saveMemory(parsed);
                    return JSON.stringify({
                        ok: true,
                        id: saved.id,
                        namespace: saved.namespace,
                        tags: saved.tags,
                        createdAt: saved.createdAt,
                    });
                }
                case "memory_search": {
                    const parsed = parseMemorySearchInput(input);
                    const results = await memoryStore.searchMemory(parsed);
                    return JSON.stringify({
                        ok: true,
                        total: results.length,
                        results,
                    });
                }
                case "web_search": {
                    const parsed = parseWebSearchInput(input);
                    const limit = parsed.limit ?? 5;
                    const results = await webSearchClient.search({
                        query: parsed.query,
                        limit,
                        ...(parsed.site !== undefined ? { site: parsed.site } : {}),
                    });
                    return JSON.stringify({
                        ok: true,
                        total: results.length,
                        results,
                    });
                }
                case "web_fetch": {
                    const parsed = parseWebFetchInput(input);
                    const result = await webSearchClient.fetchPage({
                        url: parsed.url,
                        maxChars: parsed.maxChars ?? 6_000,
                    });
                    return JSON.stringify({
                        ok: true,
                        result,
                    });
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        },
    };
}
//# sourceMappingURL=tools.js.map
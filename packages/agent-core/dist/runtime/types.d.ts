import type { MemoryStore } from "../memory/store.js";
import type { ToolDefinition } from "../tools.js";
import type { PluginRuntime } from "../plugins/runtime.js";
import type { WebSearchClient } from "./web-search.js";
export interface SharedToolRuntime {
    definitions: ToolDefinition[];
    execute(name: string, input: Record<string, unknown>): Promise<string>;
}
export interface BuildSharedToolRuntimeOptions {
    memoryStore?: MemoryStore;
    now?: () => Date;
    pluginRuntime?: PluginRuntime;
    webSearchClient?: WebSearchClient;
}
export interface CalculateToolInput {
    expression: string;
}
export interface SaveMemoryToolInput {
    text: string;
    namespace?: string;
    tags?: string[];
}
export interface MemorySearchToolInput {
    query: string;
    namespace?: string;
    limit?: number;
}
export interface WebSearchToolInput {
    query: string;
    limit?: number;
    site?: string;
}
export interface WebFetchToolInput {
    url: string;
    maxChars?: number;
}
//# sourceMappingURL=types.d.ts.map
import type { CalculateToolInput, WebFetchToolInput, WebSearchToolInput, MemorySearchToolInput, SaveMemoryToolInput } from "./types.js";
export declare function parseEmptyObjectInput(input: unknown): void;
export declare function parseCalculateInput(input: unknown): CalculateToolInput;
export declare function parseSaveMemoryInput(input: unknown): SaveMemoryToolInput;
export declare function parseMemorySearchInput(input: unknown): MemorySearchToolInput;
export declare function parseWebSearchInput(input: unknown): WebSearchToolInput;
export declare function parseWebFetchInput(input: unknown): WebFetchToolInput;
//# sourceMappingURL=tool-input-parsers.d.ts.map
import type { MemoryStore } from "./store.js";
export interface MemoryIndexRunOptions {
    limit?: number;
}
export interface MemoryIndexRunResult {
    indexed: number;
    skipped: number;
}
export declare function runMemoryIndexingJob(store: MemoryStore, options?: MemoryIndexRunOptions): Promise<MemoryIndexRunResult>;
//# sourceMappingURL=indexer.d.ts.map
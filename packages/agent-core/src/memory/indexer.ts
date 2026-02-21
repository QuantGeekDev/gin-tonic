import type { MemoryStore } from "./store.js";

export interface MemoryIndexRunOptions {
  limit?: number;
}

export interface MemoryIndexRunResult {
  indexed: number;
  skipped: number;
}

export async function runMemoryIndexingJob(
  store: MemoryStore,
  options: MemoryIndexRunOptions = {},
): Promise<MemoryIndexRunResult> {
  const limit = Math.max(1, Math.floor(options.limit ?? 100));
  return store.backfillEmbeddings(limit);
}

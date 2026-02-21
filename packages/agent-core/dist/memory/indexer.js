export async function runMemoryIndexingJob(store, options = {}) {
    const limit = Math.max(1, Math.floor(options.limit ?? 100));
    return store.backfillEmbeddings(limit);
}
//# sourceMappingURL=indexer.js.map
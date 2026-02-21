import type { MemoryEmbeddingProvider } from "./embeddings.js";
interface MemoryRecord {
    id: string;
    namespace: string;
    text: string;
    tags: string[];
    createdAt: string;
    embedding?: number[];
}
export interface SaveMemoryInput {
    text: string;
    namespace?: string;
    tags?: string[];
}
export interface SavedMemory {
    id: string;
    namespace: string;
    text: string;
    tags: string[];
    createdAt: string;
}
export interface MemorySearchInput {
    query: string;
    namespace?: string;
    limit?: number;
}
export interface MemorySearchResult {
    id: string;
    namespace: string;
    text: string;
    tags: string[];
    createdAt: string;
    score: number;
}
export interface MemoryIndexingJobResult {
    indexed: number;
    skipped: number;
}
export interface MemoryStoreOptions {
    embeddingProvider: MemoryEmbeddingProvider | undefined;
}
export declare class MemoryStore {
    private readonly memoryDir;
    protected readonly embeddingProvider: MemoryEmbeddingProvider | undefined;
    constructor(memoryDir?: string, options?: Partial<MemoryStoreOptions>);
    get directory(): string;
    protected getEmbeddingProvider(): MemoryEmbeddingProvider | undefined;
    protected maybeEmbed(text: string): Promise<number[] | undefined>;
    private get filePath();
    private ensureDirectory;
    protected loadAll(): Promise<MemoryRecord[]>;
    protected saveAll(records: MemoryRecord[]): Promise<void>;
    saveMemory(input: SaveMemoryInput): Promise<SavedMemory>;
    searchMemory(input: MemorySearchInput): Promise<MemorySearchResult[]>;
    backfillEmbeddings(limit?: number): Promise<MemoryIndexingJobResult>;
}
export {};
//# sourceMappingURL=store.d.ts.map
export interface MemoryEmbeddingProvider {
    readonly id: string;
    embed(text: string): Promise<number[]>;
}
export declare class OpenAiMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
    readonly id = "openai";
    private readonly client;
    private readonly model;
    constructor(params: {
        apiKey: string;
        model?: string;
    });
    embed(text: string): Promise<number[]>;
}
export declare function resolveMemoryEmbeddingProviderFromEnv(env: Record<string, string | undefined>): MemoryEmbeddingProvider | undefined;
//# sourceMappingURL=embeddings.d.ts.map
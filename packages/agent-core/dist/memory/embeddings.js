import OpenAI from "openai";
export class OpenAiMemoryEmbeddingProvider {
    id = "openai";
    client;
    model;
    constructor(params) {
        this.client = new OpenAI({ apiKey: params.apiKey });
        this.model = params.model ?? "text-embedding-3-small";
    }
    async embed(text) {
        const response = await this.client.embeddings.create({
            model: this.model,
            input: text,
        });
        const vector = response.data[0]?.embedding;
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error("embedding provider returned an empty vector");
        }
        return vector.map((value) => Number(value));
    }
}
export function resolveMemoryEmbeddingProviderFromEnv(env) {
    const provider = env.JIHN_MEMORY_EMBEDDING_PROVIDER?.trim().toLowerCase();
    if (provider !== "openai") {
        return undefined;
    }
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        return undefined;
    }
    const model = env.JIHN_MEMORY_EMBEDDING_MODEL?.trim() || env.OPENAI_EMBEDDING_MODEL?.trim();
    return new OpenAiMemoryEmbeddingProvider({
        apiKey,
        ...(model ? { model } : {}),
    });
}
//# sourceMappingURL=embeddings.js.map
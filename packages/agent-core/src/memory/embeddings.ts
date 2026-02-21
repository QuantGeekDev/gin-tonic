import OpenAI from "openai";

export interface MemoryEmbeddingProvider {
  readonly id: string;
  embed(text: string): Promise<number[]>;
}

export class OpenAiMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
  public readonly id = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  public constructor(params: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: params.apiKey });
    this.model = params.model ?? "text-embedding-3-small";
  }

  public async embed(text: string): Promise<number[]> {
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

export function resolveMemoryEmbeddingProviderFromEnv(
  env: Record<string, string | undefined>,
): MemoryEmbeddingProvider | undefined {
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

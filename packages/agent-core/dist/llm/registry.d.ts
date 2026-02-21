import { type LlmProviderClient, type LlmProviderId } from "./types.js";
export declare const DEFAULT_LLM_PROVIDER_ID: LlmProviderId;
export declare const DEFAULT_LLM_MODEL: "claude-sonnet-4-6" | "claude-3-5-haiku-latest" | "claude-3-5-haiku-20241022" | "claude-sonnet-4-5-20250929" | "claude-sonnet-4-5" | "claude-4-sonnet-20250514" | "claude-sonnet-4-20250514" | "claude-sonnet-4-0";
export interface LlmProviderConfig {
    providerId: LlmProviderId;
    model: string;
}
export declare function listRegisteredProviderIds(): string[];
export declare function resolveLlmProviderId(rawProviderId: string | undefined): LlmProviderId;
export declare function resolveLlmModelForProvider(providerId: LlmProviderId, rawModel: string | undefined): string;
export declare function resolveLlmConfigFromEnv(env: Record<string, string | undefined> & {
    JIHN_LLM_PROVIDER?: string;
    JIHN_LLM_MODEL?: string;
    ANTHROPIC_MODEL?: string;
    OPENAI_MODEL?: string;
}): LlmProviderConfig;
export declare function createLlmProviderClient(providerId: LlmProviderId, apiKey?: string): LlmProviderClient;
//# sourceMappingURL=registry.d.ts.map
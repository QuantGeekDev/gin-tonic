import Anthropic from "@anthropic-ai/sdk";
import { type LlmProviderClient } from "../types.js";
export declare const ANTHROPIC_MODEL_CATALOG: readonly ["claude-sonnet-4-6", "claude-3-5-haiku-latest", "claude-3-5-haiku-20241022", "claude-sonnet-4-5-20250929", "claude-sonnet-4-5", "claude-4-sonnet-20250514", "claude-sonnet-4-20250514", "claude-sonnet-4-0"];
export type AnthropicModel = (typeof ANTHROPIC_MODEL_CATALOG)[number];
export declare const DEFAULT_ANTHROPIC_MODEL: AnthropicModel;
export declare function resolveAnthropicModel(rawModel: string | undefined): AnthropicModel;
export declare function createAnthropicClient(apiKey?: string | undefined): Anthropic;
export declare function createAnthropicProviderClient(apiKey?: string | undefined): LlmProviderClient;
//# sourceMappingURL=anthropic.d.ts.map
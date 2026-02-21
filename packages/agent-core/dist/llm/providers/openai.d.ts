import OpenAI from "openai";
import { type LlmProviderClient } from "../types.js";
export declare const OPENAI_MODEL_CATALOG: readonly ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"];
export type OpenAIModel = (typeof OPENAI_MODEL_CATALOG)[number] | (string & {});
export declare const DEFAULT_OPENAI_MODEL: OpenAIModel;
export declare function resolveOpenAIModel(rawModel: string | undefined): OpenAIModel;
export declare function createOpenAIClient(apiKey?: string | undefined): OpenAI;
export declare function createOpenAIProviderClient(apiKey?: string | undefined): LlmProviderClient;
//# sourceMappingURL=openai.d.ts.map
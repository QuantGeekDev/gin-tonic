import {
  createAnthropicProviderClient,
  DEFAULT_ANTHROPIC_MODEL,
  resolveAnthropicModel,
} from "./providers/anthropic.js";
import {
  createOpenAIProviderClient,
  resolveOpenAIModel,
} from "./providers/openai.js";
import { LLM_PROVIDER_IDS, type LlmProviderClient, type LlmProviderId } from "./types.js";
import { z } from "zod";

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = LLM_PROVIDER_IDS.ANTHROPIC;
export const DEFAULT_LLM_MODEL = DEFAULT_ANTHROPIC_MODEL;

export interface LlmProviderConfig {
  providerId: LlmProviderId;
  model: string;
}

type ProviderFactory = (apiKey?: string) => LlmProviderClient;
type ModelResolver = (rawModel: string | undefined) => string;

interface ProviderRegistration {
  createClient: ProviderFactory;
  resolveModel: ModelResolver;
}

const PROVIDER_REGISTRY: Record<string, ProviderRegistration> = {
  [LLM_PROVIDER_IDS.ANTHROPIC]: {
    createClient: createAnthropicProviderClient,
    resolveModel: resolveAnthropicModel,
  },
  [LLM_PROVIDER_IDS.OPENAI]: {
    createClient: createOpenAIProviderClient,
    resolveModel: resolveOpenAIModel,
  },
};

export function listRegisteredProviderIds(): string[] {
  return Object.keys(PROVIDER_REGISTRY).sort();
}

export function resolveLlmProviderId(rawProviderId: string | undefined): LlmProviderId {
  const normalized = rawProviderId?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return DEFAULT_LLM_PROVIDER_ID;
  }
  if (normalized in PROVIDER_REGISTRY) {
    return normalized as LlmProviderId;
  }

  throw new Error(
    `Unsupported JIHN_LLM_PROVIDER '${rawProviderId}'. Allowed: ${listRegisteredProviderIds().join(", ")}`,
  );
}

export function resolveLlmModelForProvider(
  providerId: LlmProviderId,
  rawModel: string | undefined,
): string {
  const registration = PROVIDER_REGISTRY[providerId];
  if (registration === undefined) {
    throw new Error(
      `Unsupported LLM provider '${providerId}'. Allowed: ${listRegisteredProviderIds().join(", ")}`,
    );
  }
  return registration.resolveModel(rawModel);
}

export function resolveLlmConfigFromEnv(env: Record<string, string | undefined> & {
  JIHN_LLM_PROVIDER?: string;
  JIHN_LLM_MODEL?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_MODEL?: string;
}): LlmProviderConfig {
  const parsedEnv = z
    .object({
      JIHN_LLM_PROVIDER: z.string().optional(),
      JIHN_LLM_MODEL: z.string().optional(),
      ANTHROPIC_MODEL: z.string().optional(),
      OPENAI_MODEL: z.string().optional(),
    })
    .parse(env);
  const providerId = resolveLlmProviderId(parsedEnv.JIHN_LLM_PROVIDER);
  const providerDefaultModel =
    providerId === LLM_PROVIDER_IDS.ANTHROPIC
      ? parsedEnv.ANTHROPIC_MODEL
      : providerId === LLM_PROVIDER_IDS.OPENAI
        ? parsedEnv.OPENAI_MODEL
        : undefined;
  const rawModel = parsedEnv.JIHN_LLM_MODEL ?? providerDefaultModel;
  return {
    providerId,
    model: resolveLlmModelForProvider(providerId, rawModel),
  };
}

export function createLlmProviderClient(
  providerId: LlmProviderId,
  apiKey?: string,
): LlmProviderClient {
  const registration = PROVIDER_REGISTRY[providerId];
  if (registration === undefined) {
    throw new Error(
      `Unsupported LLM provider '${providerId}'. Allowed: ${listRegisteredProviderIds().join(", ")}`,
    );
  }
  return registration.createClient(apiKey);
}

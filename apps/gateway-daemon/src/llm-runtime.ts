import {
  createLlmProviderClient,
  resolveAnthropicModel,
  resolveLlmConfigFromEnv,
  type LlmProviderClient,
  type LlmProviderConfig,
} from "@jihn/agent-core";
import { validateGatewayLlmEnv } from "./env-validation.js";

const DEFAULT_HAIKU_MODEL = "claude-3-5-haiku-latest";

function readAlias(env: NodeJS.ProcessEnv): string {
  return env.JIHN_LLM_MODEL_ALIAS?.trim().toLowerCase() ?? "default";
}

function resolveAnthropicAliasModel(alias: string, env: NodeJS.ProcessEnv): string {
  if (alias === "default") {
    return resolveLlmConfigFromEnv(env).model;
  }
  if (alias === "sonnet") {
    const sonnet =
      env.JIHN_ANTHROPIC_MODEL_SONNET?.trim() ||
      env.ANTHROPIC_MODEL?.trim() ||
      "claude-sonnet-4-6";
    return resolveAnthropicModel(sonnet);
  }
  if (alias === "haiku") {
    const haiku = env.JIHN_ANTHROPIC_MODEL_HAIKU?.trim() || DEFAULT_HAIKU_MODEL;
    return resolveAnthropicModel(haiku);
  }
  throw new Error(
    `Unsupported JIHN_LLM_MODEL_ALIAS '${alias}'. Allowed: default, sonnet, haiku`,
  );
}

function resolveModelWithAlias(base: LlmProviderConfig, env: NodeJS.ProcessEnv): string {
  const alias = readAlias(env);
  if (alias === "default") {
    return base.model;
  }

  if (base.providerId === "anthropic") {
    return resolveAnthropicAliasModel(alias, env);
  }

  throw new Error(
    `JIHN_LLM_MODEL_ALIAS='${alias}' is only supported with JIHN_LLM_PROVIDER=anthropic.`,
  );
}

export interface ResolvedRuntimeLlm {
  providerId: LlmProviderConfig["providerId"];
  model: string;
  client: LlmProviderClient;
}

export class GatewayLlmRuntime {
  private readonly clientsByProvider = new Map<string, LlmProviderClient>();

  public resolve(env: NodeJS.ProcessEnv): ResolvedRuntimeLlm {
    const base = resolveLlmConfigFromEnv(env);
    validateGatewayLlmEnv({ providerId: base.providerId, env });
    const model = resolveModelWithAlias(base, env);
    const cached = this.clientsByProvider.get(base.providerId);
    if (cached !== undefined) {
      return {
        providerId: base.providerId,
        model,
        client: cached,
      };
    }
    const created = createLlmProviderClient(
      base.providerId,
      base.providerId === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY,
    );
    this.clientsByProvider.set(base.providerId, created);
    return {
      providerId: base.providerId,
      model,
      client: created,
    };
  }
}

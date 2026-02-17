/**
 * Provider-owned Anthropic model catalog.
 * Keep this in one module to avoid model drift across the codebase.
 */
export const ANTHROPIC_MODEL_CATALOG = [
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-4-sonnet-20250514",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-0",
] as const;

export type AnthropicModel = (typeof ANTHROPIC_MODEL_CATALOG)[number];

export const DEFAULT_ANTHROPIC_MODEL: AnthropicModel =
  "claude-sonnet-4-5-20250929";

const ANTHROPIC_MODEL_SET = new Set<string>(ANTHROPIC_MODEL_CATALOG);

export function resolveAnthropicModel(rawModel: string | undefined): AnthropicModel {
  if (rawModel === undefined || rawModel.trim().length === 0) {
    return DEFAULT_ANTHROPIC_MODEL;
  }

  if (ANTHROPIC_MODEL_SET.has(rawModel)) {
    return rawModel as AnthropicModel;
  }

  throw new Error(
    `Unsupported ANTHROPIC_MODEL '${rawModel}'. Allowed: ${ANTHROPIC_MODEL_CATALOG.join(", ")}`,
  );
}

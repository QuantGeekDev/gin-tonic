import Anthropic from "@anthropic-ai/sdk";
export const ANTHROPIC_MODEL_CATALOG = [
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-5",
    "claude-4-sonnet-20250514",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-0",
];
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const ANTHROPIC_MODEL_SET = new Set(ANTHROPIC_MODEL_CATALOG);
export function resolveAnthropicModel(rawModel) {
    if (rawModel === undefined || rawModel.trim().length === 0) {
        return DEFAULT_ANTHROPIC_MODEL;
    }
    if (ANTHROPIC_MODEL_SET.has(rawModel)) {
        return rawModel;
    }
    throw new Error(`Unsupported ANTHROPIC_MODEL '${rawModel}'. Allowed: ${ANTHROPIC_MODEL_CATALOG.join(", ")}`);
}
export function createAnthropicClient(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (apiKey === undefined || apiKey.trim().length === 0) {
        throw new Error("ANTHROPIC_API_KEY is required to call Anthropic.");
    }
    return new Anthropic({ apiKey });
}
//# sourceMappingURL=anthropic.js.map
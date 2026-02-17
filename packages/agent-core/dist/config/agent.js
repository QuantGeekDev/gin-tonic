export const DEFAULT_SYSTEM_PROMPT = "You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.";
export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
export function resolveSystemPrompt(rawPrompt) {
    if (rawPrompt === undefined) {
        return DEFAULT_SYSTEM_PROMPT;
    }
    const trimmed = rawPrompt.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_SYSTEM_PROMPT;
}
export function resolvePositiveInteger(rawValue, fallback) {
    if (rawValue === undefined) {
        return fallback;
    }
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}
//# sourceMappingURL=agent.js.map
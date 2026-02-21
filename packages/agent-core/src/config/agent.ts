export const DEFAULT_SYSTEM_PROMPT =
  "You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.";

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_TOKENS = 1024;

export function resolveSystemPrompt(rawPrompt: string | undefined): string {
  if (rawPrompt === undefined) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  const trimmed = rawPrompt.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SYSTEM_PROMPT;
}

export function resolvePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

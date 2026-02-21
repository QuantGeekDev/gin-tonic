const PLACEHOLDER_PATTERNS = [
  "replace_me",
  "your_",
  "changeme",
  "change_me",
  "<",
  "placeholder",
] as const;

function isUnset(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function validateGatewayLlmEnv(params: {
  providerId: string;
  env: Record<string, string | undefined>;
}): void {
  const keyName =
    params.providerId === "openai"
      ? "OPENAI_API_KEY"
      : params.providerId === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : undefined;

  if (keyName === undefined) {
    return;
  }

  const rawValue = params.env[keyName];
  if (isUnset(rawValue)) {
    throw new Error(`${keyName} is required when JIHN_LLM_PROVIDER=${params.providerId}.`);
  }
  const value = rawValue as string;
  if (looksLikePlaceholder(value)) {
    throw new Error(
      `${keyName} appears to be a placeholder value. Set a real API key before starting gateway-daemon.`,
    );
  }
}

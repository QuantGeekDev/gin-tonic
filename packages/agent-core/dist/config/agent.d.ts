export declare const DEFAULT_SYSTEM_PROMPT = "You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.";
export declare const DEFAULT_MAX_TURNS = 20;
export declare const DEFAULT_MAX_TOKENS = 1024;
export declare const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
export declare function resolveSystemPrompt(rawPrompt: string | undefined): string;
export declare function resolvePositiveInteger(rawValue: string | undefined, fallback: number): number;
//# sourceMappingURL=agent.d.ts.map
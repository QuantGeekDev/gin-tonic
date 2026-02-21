export type ToolPolicyMode = "allow" | "deny" | "review";
export interface ToolPolicyDecisionContext {
    toolName: string;
    input: Record<string, unknown>;
    metadata?: Record<string, string>;
}
export type ToolApprovalHook = (context: ToolPolicyDecisionContext) => Promise<boolean | "allow" | "deny">;
export interface ToolPolicy {
    mode: ToolPolicyMode;
    toolNames?: string[];
    requestApproval?: ToolApprovalHook;
}
export declare class ToolPolicyError extends Error {
    readonly code = "TOOL_POLICY_BLOCKED";
    constructor(message: string);
}
export interface CreatePolicyExecutorParams {
    executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
    policy?: ToolPolicy;
    metadata?: Record<string, string>;
}
export declare function createPolicyExecutor(params: CreatePolicyExecutorParams): (name: string, input: Record<string, unknown>) => Promise<string>;
export declare function resolveToolPolicy(rawMode: string | undefined, rawToolNames: string | undefined): ToolPolicy | undefined;
//# sourceMappingURL=policy.d.ts.map
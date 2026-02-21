export type ToolPolicyMode = "allow" | "deny" | "review";

export interface ToolPolicyDecisionContext {
  toolName: string;
  input: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export type ToolApprovalHook = (
  context: ToolPolicyDecisionContext,
) => Promise<boolean | "allow" | "deny">;

export interface ToolPolicy {
  mode: ToolPolicyMode;
  toolNames?: string[];
  requestApproval?: ToolApprovalHook;
}

export class ToolPolicyError extends Error {
  public readonly code = "TOOL_POLICY_BLOCKED";

  public constructor(message: string) {
    super(message);
    this.name = "ToolPolicyError";
  }
}

function normalizeToolNames(toolNames: string[] | undefined): Set<string> {
  return new Set(
    (toolNames ?? [])
      .map((toolName) => toolName.trim())
      .filter((toolName) => toolName.length > 0),
  );
}

function isAllowedByMode(
  mode: ToolPolicyMode,
  selectedToolNames: Set<string>,
  toolName: string,
): boolean {
  if (mode === "allow") {
    return selectedToolNames.size === 0 || selectedToolNames.has(toolName);
  }

  if (mode === "deny") {
    return selectedToolNames.size > 0
      ? !selectedToolNames.has(toolName)
      : false;
  }

  return true;
}

export interface CreatePolicyExecutorParams {
  executeTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<string>;
  policy?: ToolPolicy;
  metadata?: Record<string, string>;
}

export function createPolicyExecutor(
  params: CreatePolicyExecutorParams,
): (name: string, input: Record<string, unknown>) => Promise<string> {
  const { executeTool, policy } = params;
  if (policy === undefined) {
    return executeTool;
  }

  const selectedToolNames = normalizeToolNames(policy.toolNames);
  return async (name, input) => {
    const context: ToolPolicyDecisionContext = {
      toolName: name,
      input,
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    };

    const allowedByMode = isAllowedByMode(policy.mode, selectedToolNames, name);
    if (!allowedByMode) {
      throw new ToolPolicyError(
        `Tool "${name}" blocked by policy mode "${policy.mode}".`,
      );
    }

    if (policy.mode === "review") {
      const requiresReview =
        selectedToolNames.size === 0 || selectedToolNames.has(name);
      if (requiresReview) {
        if (policy.requestApproval === undefined) {
          throw new ToolPolicyError(
            `Tool "${name}" requires operator approval, but no approval hook is configured.`,
          );
        }

        const reviewDecision = await policy.requestApproval(context);
        const approved = reviewDecision === true || reviewDecision === "allow";
        if (!approved) {
          throw new ToolPolicyError(
            `Tool "${name}" denied by operator review policy.`,
          );
        }
      }
    }

    return executeTool(name, input);
  };
}

function splitToolNames(rawToolNames: string | undefined): string[] | undefined {
  if (rawToolNames === undefined) {
    return undefined;
  }
  return rawToolNames
    .split(",")
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0);
}

export function resolveToolPolicy(
  rawMode: string | undefined,
  rawToolNames: string | undefined,
): ToolPolicy | undefined {
  if (rawMode === undefined) {
    return undefined;
  }

  const normalizedMode = rawMode.trim().toLowerCase();
  if (
    normalizedMode !== "allow" &&
    normalizedMode !== "deny" &&
    normalizedMode !== "review"
  ) {
    throw new Error(
      `Unsupported tool policy mode "${rawMode}". Expected one of: allow, deny, review.`,
    );
  }

  const toolNames = splitToolNames(rawToolNames);
  return {
    mode: normalizedMode,
    ...(toolNames !== undefined ? { toolNames } : {}),
  };
}


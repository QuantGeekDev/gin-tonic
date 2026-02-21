export class ToolPolicyError extends Error {
    code = "TOOL_POLICY_BLOCKED";
    constructor(message) {
        super(message);
        this.name = "ToolPolicyError";
    }
}
function normalizeToolNames(toolNames) {
    return new Set((toolNames ?? [])
        .map((toolName) => toolName.trim())
        .filter((toolName) => toolName.length > 0));
}
function isAllowedByMode(mode, selectedToolNames, toolName) {
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
export function createPolicyExecutor(params) {
    const { executeTool, policy } = params;
    if (policy === undefined) {
        return executeTool;
    }
    const selectedToolNames = normalizeToolNames(policy.toolNames);
    return async (name, input) => {
        const context = {
            toolName: name,
            input,
            ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
        };
        const allowedByMode = isAllowedByMode(policy.mode, selectedToolNames, name);
        if (!allowedByMode) {
            throw new ToolPolicyError(`Tool "${name}" blocked by policy mode "${policy.mode}".`);
        }
        if (policy.mode === "review") {
            const requiresReview = selectedToolNames.size === 0 || selectedToolNames.has(name);
            if (requiresReview) {
                if (policy.requestApproval === undefined) {
                    throw new ToolPolicyError(`Tool "${name}" requires operator approval, but no approval hook is configured.`);
                }
                const reviewDecision = await policy.requestApproval(context);
                const approved = reviewDecision === true || reviewDecision === "allow";
                if (!approved) {
                    throw new ToolPolicyError(`Tool "${name}" denied by operator review policy.`);
                }
            }
        }
        return executeTool(name, input);
    };
}
function splitToolNames(rawToolNames) {
    if (rawToolNames === undefined) {
        return undefined;
    }
    return rawToolNames
        .split(",")
        .map((toolName) => toolName.trim())
        .filter((toolName) => toolName.length > 0);
}
export function resolveToolPolicy(rawMode, rawToolNames) {
    if (rawMode === undefined) {
        return undefined;
    }
    const normalizedMode = rawMode.trim().toLowerCase();
    if (normalizedMode !== "allow" &&
        normalizedMode !== "deny" &&
        normalizedMode !== "review") {
        throw new Error(`Unsupported tool policy mode "${rawMode}". Expected one of: allow, deny, review.`);
    }
    const toolNames = splitToolNames(rawToolNames);
    return {
        mode: normalizedMode,
        ...(toolNames !== undefined ? { toolNames } : {}),
    };
}
//# sourceMappingURL=policy.js.map
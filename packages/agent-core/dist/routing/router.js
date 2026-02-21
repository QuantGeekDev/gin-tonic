const DEFAULT_AGENT_ID = "main";
const RESEARCH_PREFIX = "/research";
const NAMED_AGENT_PREFIX = "/agent:";
const VALID_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function resolveDefaultAgentId(rawDefaultAgentId) {
    const trimmed = rawDefaultAgentId?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
        return trimmed;
    }
    return DEFAULT_AGENT_ID;
}
function readNamedAgentDirective(trimmedInput) {
    if (!trimmedInput.startsWith(NAMED_AGENT_PREFIX)) {
        return null;
    }
    const remainder = trimmedInput.slice(NAMED_AGENT_PREFIX.length);
    const spaceIndex = remainder.search(/\s/);
    const rawAgentId = spaceIndex === -1 ? remainder : remainder.slice(0, Math.max(0, spaceIndex));
    const agentId = rawAgentId.trim();
    if (agentId.length === 0 || !VALID_AGENT_ID.test(agentId)) {
        return null;
    }
    const routedText = spaceIndex === -1
        ? ""
        : remainder.slice(spaceIndex).trimStart();
    return {
        kind: "named",
        agentId,
        text: routedText,
    };
}
function readResearchDirective(trimmedInput) {
    if (!trimmedInput.startsWith(RESEARCH_PREFIX)) {
        return null;
    }
    const trailing = trimmedInput.slice(RESEARCH_PREFIX.length, RESEARCH_PREFIX.length + 1);
    if (trailing.length > 0 && !/\s/.test(trailing)) {
        return null;
    }
    return {
        kind: "research",
        agentId: "research",
        text: trimmedInput.slice(RESEARCH_PREFIX.length).trimStart(),
    };
}
export function resolveAgentRoute(input) {
    const defaultAgentId = resolveDefaultAgentId(input.defaultAgentId);
    const trimmedInput = input.text.trimStart();
    const named = readNamedAgentDirective(trimmedInput);
    if (named !== null) {
        return named;
    }
    const research = readResearchDirective(trimmedInput);
    if (research !== null) {
        return research;
    }
    return {
        kind: "default",
        agentId: defaultAgentId,
        text: input.text,
    };
}
//# sourceMappingURL=router.js.map
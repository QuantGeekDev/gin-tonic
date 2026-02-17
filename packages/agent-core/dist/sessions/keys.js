function sanitizeKeyPart(value) {
    return value.trim().replace(/[/:\\\s]+/g, "_");
}
export const buildSessionKey = (params) => {
    const agentId = sanitizeKeyPart(params.agentId);
    const scope = sanitizeKeyPart(params.scope);
    const peerId = sanitizeKeyPart(params.peerId);
    const channelId = sanitizeKeyPart(params.channelId);
    return `agent:${agentId}:scope:${scope}:peer:${peerId}:channel:${channelId}`;
};
//# sourceMappingURL=keys.js.map
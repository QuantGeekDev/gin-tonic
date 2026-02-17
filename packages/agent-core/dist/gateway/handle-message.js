import { runAgentTurn } from "../agent/loop.js";
import { buildSessionKey } from "../sessions/keys.js";
import { SessionStore } from "../sessions/store.js";
const DEFAULT_AGENT_ID = "main";
const DEFAULT_SCOPE = "peer";
const DEFAULT_CHANNEL_ID = "unknown-channel";
const DEFAULT_PEER_ID = "anonymous";
const DEFAULT_SESSION_STORE = new SessionStore();
function resolveNonEmpty(value, fallback) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : fallback;
}
function resolveRouting(routing) {
    const resolved = {
        agentId: resolveNonEmpty(routing?.agentId, DEFAULT_AGENT_ID),
        scope: routing?.scope ?? DEFAULT_SCOPE,
        channelId: resolveNonEmpty(routing?.channelId, DEFAULT_CHANNEL_ID),
        peerId: resolveNonEmpty(routing?.peerId, DEFAULT_PEER_ID),
    };
    const sessionKey = buildSessionKey(resolved);
    return {
        ...resolved,
        sessionKey,
    };
}
function hasStablePrefix(prefix, value) {
    if (prefix.length > value.length) {
        return false;
    }
    for (let index = 0; index < prefix.length; index += 1) {
        if (JSON.stringify(prefix[index]) !== JSON.stringify(value[index])) {
            return false;
        }
    }
    return true;
}
export async function handleMessage(params) {
    const text = params.text.trim();
    if (text.length === 0) {
        throw new Error("text must be a non-empty string");
    }
    const routing = resolveRouting(params.routing);
    const store = params.sessionStore ?? DEFAULT_SESSION_STORE;
    const runTurn = params.runTurn ?? runAgentTurn;
    const existingMessages = await store.load(routing.sessionKey);
    const turnInputMessages = [
        ...existingMessages,
        { role: "user", content: text },
    ];
    const turnParams = {
        client: params.client,
        messages: turnInputMessages,
        systemPrompt: params.systemPrompt,
        tools: params.tools,
        executeTool: params.executeTool,
        ...(params.model !== undefined ? { model: params.model } : {}),
        ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
        ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
    };
    const turnResult = await runTurn(turnParams);
    let persistenceMode = "append";
    if (hasStablePrefix(existingMessages, turnResult.messages)) {
        const newMessages = turnResult.messages.slice(existingMessages.length);
        for (const message of newMessages) {
            await store.append(routing.sessionKey, message);
        }
    }
    else {
        persistenceMode = "save";
        await store.save(routing.sessionKey, turnResult.messages);
    }
    return {
        text: turnResult.text,
        messages: turnResult.messages,
        usage: turnResult.usage,
        routing,
        persistenceMode,
    };
}
//# sourceMappingURL=handle-message.js.map
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const DEFAULT_CACHE_TTL_MS = 30_000;
function sanitizeSegment(value) {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    return normalized.length > 0 ? normalized : "tool";
}
function toExposedToolName(serverId, remoteName) {
    return `mcp__${sanitizeSegment(serverId)}__${sanitizeSegment(remoteName)}`;
}
function serializeCallToolResult(result) {
    if (result.toolResult !== undefined) {
        return typeof result.toolResult === "string"
            ? result.toolResult
            : JSON.stringify(result.toolResult);
    }
    if (result.structuredContent !== undefined) {
        return JSON.stringify({
            ...(result.isError === true ? { isError: true } : {}),
            structuredContent: result.structuredContent,
            ...(Array.isArray(result.content) ? { content: result.content } : {}),
        });
    }
    if (!Array.isArray(result.content) || result.content.length === 0) {
        return result.isError === true ? "MCP tool returned an error." : "";
    }
    const lines = result.content.map((block) => {
        if (block.type === "text") {
            return block.text;
        }
        if (block.type === "image") {
            return `[image${block.mimeType ? ` ${block.mimeType}` : ""}]`;
        }
        if (block.type === "audio") {
            return `[audio${block.mimeType ? ` ${block.mimeType}` : ""}]`;
        }
        if (block.type === "resource") {
            if (!block.resource) {
                return "[resource]";
            }
            if (typeof block.resource.text === "string") {
                return block.resource.text;
            }
            return `[resource ${block.resource.uri}]`;
        }
        if (block.type === "resource_link") {
            return `[resource_link ${block.name} ${block.uri}]`;
        }
        return JSON.stringify(block);
    });
    const body = lines.join("\n").trim();
    if (result.isError === true) {
        return body.length > 0 ? `MCP tool error: ${body}` : "MCP tool returned an error.";
    }
    return body;
}
function toToolDefinition(serverId, tool, exposedName) {
    const inputSchema = tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object", additionalProperties: true };
    return {
        name: exposedName,
        description: `[MCP:${serverId}] ${tool.description ?? tool.name}`,
        inputSchema,
    };
}
function normalizeListedTool(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const item = value;
    if (typeof item.name !== "string" || item.name.trim().length === 0) {
        return null;
    }
    return {
        name: item.name,
        ...(typeof item.description === "string"
            ? { description: item.description }
            : {}),
        ...(typeof item.inputSchema === "object" && item.inputSchema !== null
            ? { inputSchema: item.inputSchema }
            : {}),
    };
}
function normalizeCallResult(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {};
    }
    return value;
}
class InlineOAuthProvider {
    server;
    saveState;
    constructor(server, saveState) {
        this.server = server;
        this.saveState = saveState;
    }
    get redirectUrl() {
        if (this.server.auth?.mode !== "oauth2") {
            return undefined;
        }
        return this.server.auth.oauth.redirectUrl;
    }
    get clientMetadata() {
        return {
            client_name: `Jihn MCP ${this.server.id}`,
            redirect_uris: this.redirectUrl ? [this.redirectUrl] : [],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: this.server.auth?.mode === "oauth2" && this.server.auth.oauth.clientSecret
                ? "client_secret_post"
                : "none",
        };
    }
    clientInformation() {
        if (this.server.auth?.mode !== "oauth2" || !this.server.auth.oauth.clientId) {
            return undefined;
        }
        return {
            client_id: this.server.auth.oauth.clientId,
            ...(this.server.auth.oauth.clientSecret
                ? { client_secret: this.server.auth.oauth.clientSecret }
                : {}),
        };
    }
    async saveClientInformation(info) {
        if (this.server.auth?.mode !== "oauth2") {
            return;
        }
        await this.saveState({
            ...this.server.auth.oauth,
            clientId: info.client_id,
            ...(typeof info.client_secret === "string" ? { clientSecret: info.client_secret } : {}),
        });
    }
    tokens() {
        if (this.server.auth?.mode !== "oauth2" || !this.server.auth.oauth.accessToken) {
            return undefined;
        }
        return {
            access_token: this.server.auth.oauth.accessToken,
            token_type: this.server.auth.oauth.tokenType ?? "Bearer",
            ...(this.server.auth.oauth.refreshToken
                ? { refresh_token: this.server.auth.oauth.refreshToken }
                : {}),
            ...(this.server.auth.oauth.expiresAt
                ? {
                    expires_at: Math.floor(new Date(this.server.auth.oauth.expiresAt).getTime() / 1000),
                }
                : {}),
        };
    }
    async saveTokens(tokens) {
        if (this.server.auth?.mode !== "oauth2") {
            return;
        }
        await this.saveState({
            ...this.server.auth.oauth,
            accessToken: tokens.access_token,
            tokenType: tokens.token_type,
            ...(typeof tokens.refresh_token === "string"
                ? { refreshToken: tokens.refresh_token }
                : {}),
            ...(typeof tokens.expires_at === "number"
                ? { expiresAt: new Date(tokens.expires_at * 1000).toISOString() }
                : {}),
        });
    }
    async redirectToAuthorization(authorizationUrl) {
        throw new Error(`OAuth re-authorization required: ${authorizationUrl.toString()}`);
    }
    async saveCodeVerifier(codeVerifier) {
        if (this.server.auth?.mode !== "oauth2") {
            return;
        }
        await this.saveState({
            ...this.server.auth.oauth,
            codeVerifier,
        });
    }
    async codeVerifier() {
        if (this.server.auth?.mode !== "oauth2") {
            return "";
        }
        return this.server.auth.oauth.codeVerifier ?? "";
    }
}
function createDefaultInternals() {
    return {
        createClient(params) {
            return new Client({ name: params.name, version: params.version });
        },
        createTransport(params) {
            return new StreamableHTTPClientTransport(new URL(params.server.url), {
                ...(params.requestInit !== undefined ? { requestInit: params.requestInit } : {}),
                ...(params.authProvider !== undefined ? { authProvider: params.authProvider } : {}),
                ...(params.server.sessionId !== undefined
                    ? { sessionId: params.server.sessionId }
                    : {}),
            });
        },
        now() {
            return new Date();
        },
    };
}
export class McpToolRegistry {
    options;
    serverStates = new Map();
    toolDefinitions = new Map();
    toolRefs = new Map();
    lastRefreshMs = 0;
    internals;
    refreshPromise = null;
    constructor(options, internals) {
        this.options = {
            cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
            clientName: options.clientName ?? "jihn-mcp-client",
            clientVersion: options.clientVersion ?? "1.0.0",
        };
        const defaults = createDefaultInternals();
        this.internals = {
            createClient: internals?.createClient ?? defaults.createClient,
            createTransport: internals?.createTransport ?? defaults.createTransport,
            now: internals?.now ?? defaults.now,
        };
        this.setServers(options.servers);
    }
    setServers(servers) {
        this.serverStates.clear();
        for (const server of servers) {
            this.serverStates.set(server.id, {
                config: server,
                connected: false,
                lastRefreshAt: undefined,
                error: undefined,
                exposedByRemoteName: new Map(),
                remoteByExposedName: new Map(),
            });
        }
        this.toolDefinitions.clear();
        this.toolRefs.clear();
        this.lastRefreshMs = 0;
    }
    getServer(serverId) {
        return this.serverStates.get(serverId)?.config;
    }
    listServers() {
        return [...this.serverStates.values()].map((state) => state.config);
    }
    findServerByPendingOAuthState(state) {
        for (const serverState of this.serverStates.values()) {
            if (serverState.config.auth?.mode === "oauth2" &&
                serverState.config.auth.oauth.pendingState === state) {
                return serverState.config;
            }
        }
        return undefined;
    }
    async updateServerOAuthState(serverId, oauth) {
        const state = this.serverStates.get(serverId);
        if (!state) {
            throw new Error(`Unknown MCP server: ${serverId}`);
        }
        const next = {
            ...state.config,
            auth: {
                mode: "oauth2",
                oauth,
            },
        };
        state.config = next;
        state.connected = false;
        delete state.client;
        delete state.transport;
    }
    buildRequestInit(state) {
        const headers = {
            ...(state.config.headers ?? {}),
        };
        if (state.config.auth?.mode === "bearer" && state.config.auth.token.trim().length > 0) {
            headers.Authorization = `Bearer ${state.config.auth.token}`;
        }
        if (state.config.auth?.mode === "oauth2" &&
            state.config.auth.oauth.accessToken &&
            state.config.auth.oauth.accessToken.trim().length > 0) {
            headers.Authorization = `Bearer ${state.config.auth.oauth.accessToken}`;
        }
        const requestInit = {
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
            ...(state.config.requestTimeoutMs !== undefined
                ? {
                    signal: AbortSignal.timeout(state.config.requestTimeoutMs),
                }
                : {}),
        };
        return Object.keys(requestInit).length > 0 ? requestInit : undefined;
    }
    createAuthProvider(state) {
        if (state.config.auth?.mode !== "oauth2") {
            return undefined;
        }
        return new InlineOAuthProvider(state.config, async (oauth) => {
            const current = this.getServer(state.config.id);
            const currentOauth = current?.auth?.mode === "oauth2" ? current.auth.oauth : {};
            await this.updateServerOAuthState(state.config.id, {
                ...currentOauth,
                ...oauth,
            });
        });
    }
    async ensureConnected(state) {
        if (state.connected && state.client && state.transport) {
            return;
        }
        const requestInit = this.buildRequestInit(state);
        const authProvider = this.createAuthProvider(state);
        const transport = this.internals.createTransport({
            server: state.config,
            ...(requestInit !== undefined ? { requestInit } : {}),
            ...(authProvider !== undefined ? { authProvider } : {}),
        });
        const client = this.internals.createClient({
            name: this.options.clientName,
            version: this.options.clientVersion,
        });
        await client.connect(transport);
        state.client = client;
        state.transport = transport;
        state.connected = true;
        state.error = undefined;
    }
    async refreshInternal() {
        const allDefinitions = new Map();
        const allRefs = new Map();
        for (const [serverId, state] of this.serverStates) {
            if (state.config.enabled === false) {
                continue;
            }
            state.exposedByRemoteName.clear();
            state.remoteByExposedName.clear();
            try {
                await this.ensureConnected(state);
                if (!state.client) {
                    throw new Error("MCP client unavailable");
                }
                const listedTools = [];
                let cursor;
                do {
                    const response = await state.client.listTools(cursor ? { cursor } : undefined);
                    const normalized = (response.tools ?? [])
                        .map(normalizeListedTool)
                        .filter((tool) => tool !== null);
                    listedTools.push(...normalized);
                    cursor = response.nextCursor;
                } while (cursor !== undefined && cursor.length > 0);
                for (const tool of listedTools) {
                    const exposedName = toExposedToolName(serverId, tool.name);
                    const definition = toToolDefinition(serverId, tool, exposedName);
                    allDefinitions.set(exposedName, definition);
                    allRefs.set(exposedName, {
                        serverId,
                        remoteName: tool.name,
                    });
                    state.exposedByRemoteName.set(tool.name, exposedName);
                    state.remoteByExposedName.set(exposedName, tool.name);
                }
                state.lastRefreshAt = this.internals.now().toISOString();
                state.error = undefined;
            }
            catch (error) {
                state.connected = false;
                state.error = error instanceof Error ? error.message : String(error);
            }
        }
        this.toolDefinitions.clear();
        this.toolRefs.clear();
        for (const [key, definition] of allDefinitions) {
            this.toolDefinitions.set(key, definition);
        }
        for (const [key, ref] of allRefs) {
            this.toolRefs.set(key, ref);
        }
        this.lastRefreshMs = this.internals.now().getTime();
    }
    async ensureFresh(forceRefresh) {
        const nowMs = this.internals.now().getTime();
        const cacheExpired = nowMs - this.lastRefreshMs > this.options.cacheTtlMs;
        if (!forceRefresh && !cacheExpired && this.lastRefreshMs > 0) {
            return;
        }
        if (this.refreshPromise) {
            await this.refreshPromise;
            return;
        }
        this.refreshPromise = this.refreshInternal();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = null;
        }
    }
    async listToolDefinitions(options = {}) {
        await this.ensureFresh(options.forceRefresh === true);
        return {
            toolDefinitions: [...this.toolDefinitions.values()],
        };
    }
    async executeTool(exposedName, input) {
        await this.ensureFresh(false);
        const ref = this.toolRefs.get(exposedName);
        if (!ref) {
            throw new Error(`Unknown MCP tool: ${exposedName}`);
        }
        const state = this.serverStates.get(ref.serverId);
        if (!state || state.config.enabled === false) {
            throw new Error(`MCP server unavailable for tool: ${exposedName}`);
        }
        await this.ensureConnected(state);
        if (!state.client) {
            throw new Error(`MCP client unavailable for server: ${ref.serverId}`);
        }
        const result = await state.client.callTool({
            name: ref.remoteName,
            arguments: input,
        });
        return serializeCallToolResult(normalizeCallResult(result));
    }
    async getSnapshot(options = {}) {
        await this.ensureFresh(options.forceRefresh === true);
        const servers = [];
        for (const [id, state] of this.serverStates) {
            const authConfig = state.config.auth;
            const authMode = authConfig?.mode ?? "none";
            const authorized = authMode === "none"
                ? true
                : authMode === "bearer"
                    ? Boolean(authConfig && authConfig.mode === "bearer" && authConfig.token.trim().length > 0)
                    : Boolean(authConfig && authConfig.mode === "oauth2" && authConfig.oauth.accessToken);
            servers.push({
                id,
                ...(state.config.name !== undefined ? { name: state.config.name } : {}),
                url: state.config.url,
                enabled: state.config.enabled !== false,
                connected: state.connected,
                ...(state.transport?.sessionId !== undefined
                    ? { sessionId: state.transport.sessionId }
                    : {}),
                ...(state.lastRefreshAt !== undefined ? { lastRefreshAt: state.lastRefreshAt } : {}),
                toolCount: state.exposedByRemoteName.size,
                authMode,
                authorized,
                ...(state.error !== undefined ? { error: state.error } : {}),
            });
        }
        const tools = [...this.toolRefs.entries()].map(([exposedName, ref]) => ({
            exposedName,
            serverId: ref.serverId,
            remoteName: ref.remoteName,
            description: this.toolDefinitions.get(exposedName)?.description ?? ref.remoteName,
        }));
        return {
            servers,
            tools,
            generatedAt: this.internals.now().toISOString(),
        };
    }
}
export function isMcpToolName(name) {
    return name.startsWith("mcp__");
}
//# sourceMappingURL=registry.js.map
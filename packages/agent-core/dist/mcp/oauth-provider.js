import { randomBytes } from "node:crypto";
export class McpOAuthAuthorizationRequiredError extends Error {
    authorizationUrl;
    constructor(authorizationUrl) {
        super("OAuth authorization required");
        this.authorizationUrl = authorizationUrl;
    }
}
function randomUrlSafe(bytes = 24) {
    return randomBytes(bytes).toString("base64url");
}
export class McpOAuthProvider {
    options;
    constructor(options) {
        this.options = options;
    }
    get redirectUrl() {
        const existing = this.options.server.auth?.mode === "oauth2"
            ? this.options.server.auth.oauth.redirectUrl
            : undefined;
        return (existing ??
            `${this.options.baseUrl.replace(/\/$/, "")}/api/mcp/oauth/callback`);
    }
    get clientMetadata() {
        const tokenMethod = this.clientInformation()?.client_secret
            ? "client_secret_post"
            : "none";
        return {
            client_name: `Jihn MCP ${this.options.server.id}`,
            redirect_uris: [this.redirectUrl],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: tokenMethod,
        };
    }
    async state() {
        const state = randomUrlSafe();
        await this.persist({ pendingState: state });
        return state;
    }
    clientInformation() {
        const oauth = this.oauth();
        if (!oauth?.clientId) {
            return undefined;
        }
        return {
            client_id: oauth.clientId,
            ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
        };
    }
    async saveClientInformation(clientInformation) {
        await this.persist({
            clientId: clientInformation.client_id,
            ...(clientInformation.client_secret
                ? { clientSecret: clientInformation.client_secret }
                : {}),
        });
    }
    tokens() {
        const oauth = this.oauth();
        if (!oauth?.accessToken) {
            return undefined;
        }
        return {
            access_token: oauth.accessToken,
            token_type: oauth.tokenType ?? "Bearer",
            ...(oauth.refreshToken ? { refresh_token: oauth.refreshToken } : {}),
            ...(oauth.expiresAt
                ? {
                    expires_at: Math.floor(new Date(oauth.expiresAt).getTime() / 1000),
                }
                : {}),
        };
    }
    async saveTokens(tokens) {
        const expiresAt = typeof tokens.expires_in === "number"
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : undefined;
        await this.persist({
            accessToken: tokens.access_token,
            tokenType: tokens.token_type,
            ...(typeof tokens.refresh_token === "string"
                ? { refreshToken: tokens.refresh_token }
                : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
    }
    async redirectToAuthorization(authorizationUrl) {
        await this.persist({
            lastAuthorizationUrl: authorizationUrl.toString(),
        });
        throw new McpOAuthAuthorizationRequiredError(authorizationUrl.toString());
    }
    async saveCodeVerifier(codeVerifier) {
        await this.persist({ codeVerifier });
    }
    async codeVerifier() {
        const codeVerifier = this.oauth()?.codeVerifier;
        if (!codeVerifier) {
            throw new Error("OAuth PKCE verifier is missing");
        }
        return codeVerifier;
    }
    oauth() {
        return this.options.server.auth?.mode === "oauth2"
            ? this.options.server.auth.oauth
            : undefined;
    }
    async persist(delta) {
        const existing = this.oauth() ?? {};
        await this.options.saveOAuthState({
            ...existing,
            ...delta,
        });
    }
}
//# sourceMappingURL=oauth-provider.js.map
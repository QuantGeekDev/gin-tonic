import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServerConfig, McpServerOAuthState } from "./types.js";
export declare class McpOAuthAuthorizationRequiredError extends Error {
    readonly authorizationUrl: string;
    constructor(authorizationUrl: string);
}
interface McpOAuthProviderOptions {
    baseUrl: string;
    server: McpServerConfig;
    saveOAuthState(oauth: McpServerOAuthState): Promise<void>;
}
export declare class McpOAuthProvider implements OAuthClientProvider {
    private readonly options;
    constructor(options: McpOAuthProviderOptions);
    get redirectUrl(): string;
    get clientMetadata(): OAuthClientMetadata;
    state(): Promise<string>;
    clientInformation(): OAuthClientInformationMixed | undefined;
    saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void>;
    tokens(): OAuthTokens | undefined;
    saveTokens(tokens: OAuthTokens): Promise<void>;
    redirectToAuthorization(authorizationUrl: URL): Promise<void>;
    saveCodeVerifier(codeVerifier: string): Promise<void>;
    codeVerifier(): Promise<string>;
    private oauth;
    private persist;
}
export {};
//# sourceMappingURL=oauth-provider.d.ts.map
import { randomBytes } from "node:crypto";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServerConfig, McpServerOAuthState } from "./types.js";

export class McpOAuthAuthorizationRequiredError extends Error {
  public readonly authorizationUrl: string;

  public constructor(authorizationUrl: string) {
    super("OAuth authorization required");
    this.authorizationUrl = authorizationUrl;
  }
}

interface McpOAuthProviderOptions {
  baseUrl: string;
  server: McpServerConfig;
  saveOAuthState(oauth: McpServerOAuthState): Promise<void>;
}

function randomUrlSafe(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export class McpOAuthProvider implements OAuthClientProvider {
  private readonly options: McpOAuthProviderOptions;

  public constructor(options: McpOAuthProviderOptions) {
    this.options = options;
  }

  public get redirectUrl(): string {
    const existing = this.options.server.auth?.mode === "oauth2"
      ? this.options.server.auth.oauth.redirectUrl
      : undefined;

    return (
      existing ??
      `${this.options.baseUrl.replace(/\/$/, "")}/api/mcp/oauth/callback`
    );
  }

  public get clientMetadata(): OAuthClientMetadata {
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

  public async state(): Promise<string> {
    const state = randomUrlSafe();
    await this.persist({ pendingState: state });
    return state;
  }

  public clientInformation(): OAuthClientInformationMixed | undefined {
    const oauth = this.oauth();
    if (!oauth?.clientId) {
      return undefined;
    }

    return {
      client_id: oauth.clientId,
      ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
    };
  }

  public async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    await this.persist({
      clientId: clientInformation.client_id,
      ...(clientInformation.client_secret
        ? { clientSecret: clientInformation.client_secret }
        : {}),
    });
  }

  public tokens(): OAuthTokens | undefined {
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

  public async saveTokens(tokens: OAuthTokens): Promise<void> {
    const expiresAt =
      typeof tokens.expires_in === "number"
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

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.persist({
      lastAuthorizationUrl: authorizationUrl.toString(),
    });
    throw new McpOAuthAuthorizationRequiredError(authorizationUrl.toString());
  }

  public async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.persist({ codeVerifier });
  }

  public async codeVerifier(): Promise<string> {
    const codeVerifier = this.oauth()?.codeVerifier;
    if (!codeVerifier) {
      throw new Error("OAuth PKCE verifier is missing");
    }
    return codeVerifier;
  }

  private oauth(): McpServerOAuthState | undefined {
    return this.options.server.auth?.mode === "oauth2"
      ? this.options.server.auth.oauth
      : undefined;
  }

  private async persist(delta: Partial<McpServerOAuthState>): Promise<void> {
    const existing = this.oauth() ?? {};
    await this.options.saveOAuthState({
      ...existing,
      ...delta,
    });
  }
}

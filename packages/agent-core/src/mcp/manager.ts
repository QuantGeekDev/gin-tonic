import { auth, type AuthResult } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpToolRegistry } from "./registry.js";
import { McpOAuthAuthorizationRequiredError, McpOAuthProvider } from "./oauth-provider.js";
import { McpServerStore } from "./store.js";
import type {
  McpRegistrySnapshot,
  McpServerConfig,
  McpServerInput,
  McpToolResolution,
} from "./types.js";

interface McpServerManagerInternals {
  authFlow: typeof auth;
}

export interface McpServerManagerOptions {
  store: McpServerStore;
  registry: McpToolRegistry;
  baseUrl: string;
}

export class McpServerManager {
  private readonly store: McpServerStore;

  private readonly registry: McpToolRegistry;

  private readonly baseUrl: string;

  private readonly internals: McpServerManagerInternals;

  public constructor(
    options: McpServerManagerOptions,
    internals?: Partial<McpServerManagerInternals>,
  ) {
    this.store = options.store;
    this.registry = options.registry;
    this.baseUrl = options.baseUrl;
    this.internals = {
      authFlow: internals?.authFlow ?? auth,
    };
  }

  public async initializeFromStore(): Promise<void> {
    const servers = await this.store.listServers();
    this.registry.setServers(servers);
  }

  public async addServer(input: McpServerInput): Promise<McpRegistrySnapshot> {
    const sanitized: McpServerInput = {
      ...input,
      id: input.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
      url: input.url.trim(),
      auth: input.auth ?? { mode: "none" },
    };

    if (sanitized.id.length === 0 || sanitized.url.length === 0) {
      throw new Error("server id and url are required");
    }

    const servers = await this.store.upsertServer(sanitized);
    this.registry.setServers(servers);
    return this.registry.getSnapshot({ forceRefresh: true });
  }

  public async removeServer(serverId: string): Promise<McpRegistrySnapshot> {
    const servers = await this.store.removeServer(serverId);
    this.registry.setServers(servers);
    return this.registry.getSnapshot({ forceRefresh: true });
  }

  public async getSnapshot(forceRefresh = false): Promise<McpRegistrySnapshot> {
    return this.registry.getSnapshot({ forceRefresh });
  }

  public async listToolDefinitions(
    forceRefresh = false,
  ): Promise<McpToolResolution> {
    return this.registry.listToolDefinitions({ forceRefresh });
  }

  public async beginOAuth(serverId: string): Promise<{ authorizationUrl: string }> {
    const server = this.registry.getServer(serverId);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }

    const provider = this.createOAuthProvider(server);

    try {
      const result = await this.internals.authFlow(provider, {
        serverUrl: server.url,
        ...(server.auth?.mode === "oauth2" && server.auth.oauth.scope
          ? { scope: server.auth.oauth.scope }
          : {}),
      });

      if (result === "AUTHORIZED") {
        return {
          authorizationUrl: "",
        };
      }
    } catch (error) {
      if (error instanceof McpOAuthAuthorizationRequiredError) {
        return {
          authorizationUrl: error.authorizationUrl,
        };
      }
      throw error;
    }

    throw new Error("OAuth flow did not produce an authorization URL");
  }

  public async completeOAuthCallback(
    code: string,
    state: string,
  ): Promise<{ serverId: string; result: AuthResult }> {
    const server = this.registry.findServerByPendingOAuthState(state);
    if (!server) {
      throw new Error("Unknown or expired OAuth state");
    }

    const serverId = server.id;
    const provider = this.createOAuthProvider(server);
    const result = await this.internals.authFlow(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      ...(server.auth?.mode === "oauth2" && server.auth.oauth.scope
        ? { scope: server.auth.oauth.scope }
        : {}),
    });

    const latest = this.registry.getServer(serverId);
    if (!latest || latest.auth?.mode !== "oauth2") {
      throw new Error("OAuth completion failed to persist server state");
    }

    const nextOauth = {
      ...latest.auth.oauth,
    };
    delete nextOauth.pendingState;
    delete nextOauth.codeVerifier;

    await this.registry.updateServerOAuthState(serverId, nextOauth);
    await this.store.saveServers(this.registry.listServers());

    return {
      serverId,
      result,
    };
  }

  private createOAuthProvider(server: McpServerConfig): McpOAuthProvider {
    if (server.auth?.mode !== "oauth2") {
      throw new Error("Server is not configured for oauth2 auth mode");
    }

    return new McpOAuthProvider({
      baseUrl: this.baseUrl,
      server,
      saveOAuthState: async (oauth) => {
        const current = this.registry.getServer(server.id);
        const currentOauth =
          current?.auth?.mode === "oauth2" ? current.auth.oauth : {};
        await this.registry.updateServerOAuthState(server.id, {
          ...currentOauth,
          ...oauth,
        });
        await this.store.saveServers(this.registry.listServers());
      },
    });
  }
}

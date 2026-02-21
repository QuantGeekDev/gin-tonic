"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpSnapshotResponse } from "../types/agent-api";
import {
  McpActionDataSchema,
  McpSnapshotDataSchema,
} from "../types/agent-api";
import { formatApiError, readApiData } from "../lib/agent-client";

export interface UseMcpDebugResult {
  mcpSnapshot: McpSnapshotResponse | null;
  mcpLoading: boolean;
  mcpRefreshing: boolean;
  serverId: string;
  serverName: string;
  serverUrl: string;
  authMode: "none" | "bearer" | "oauth2";
  bearerToken: string;
  oauthScope: string;
  oauthClientId: string;
  oauthClientSecret: string;
  setServerId(value: string): void;
  setServerName(value: string): void;
  setServerUrl(value: string): void;
  setAuthMode(value: "none" | "bearer" | "oauth2"): void;
  setBearerToken(value: string): void;
  setOauthScope(value: string): void;
  setOauthClientId(value: string): void;
  setOauthClientSecret(value: string): void;
  refreshMcp(): Promise<void>;
  addServer(): Promise<void>;
  removeServer(serverId: string): Promise<void>;
  beginOAuth(serverId: string): Promise<void>;
}

export function useMcpDebug(
  setError: (error: string | null) => void,
): UseMcpDebugResult {
  const [mcpSnapshot, setMcpSnapshot] = useState<McpSnapshotResponse | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [serverId, setServerId] = useState("docs");
  const [serverName, setServerName] = useState("Docs MCP");
  const [serverUrl, setServerUrl] = useState("https://mcp.example.com/mcp");
  const [authMode, setAuthMode] = useState<"none" | "bearer" | "oauth2">("none");
  const [bearerToken, setBearerToken] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");

  const loadSnapshot = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      if (forceRefresh) {
        setMcpRefreshing(true);
      } else {
        setMcpLoading(true);
      }
      setError(null);

      try {
        const response = forceRefresh
          ? await fetch("/api/mcp", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "refresh" }),
            })
          : await fetch("/api/mcp", { method: "GET" });

        if (forceRefresh) {
          const data = await readApiData(response, McpActionDataSchema);
          if (data.snapshot !== undefined) {
            setMcpSnapshot(data.snapshot as McpSnapshotResponse);
            return;
          }
          throw new Error("Missing MCP snapshot in refresh response.");
        }

        const data = await readApiData(response, McpSnapshotDataSchema);
        setMcpSnapshot(data as McpSnapshotResponse);
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setMcpLoading(false);
        setMcpRefreshing(false);
      }
    },
    [setError],
  );

  const addServer = useCallback(async (): Promise<void> => {
    setMcpRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_server",
          id: serverId,
          name: serverName,
          url: serverUrl,
          authMode,
          ...(authMode === "bearer" ? { bearerToken } : {}),
          ...(authMode === "oauth2"
            ? {
                scope: oauthScope,
                clientId: oauthClientId,
                clientSecret: oauthClientSecret,
              }
            : {}),
        }),
      });
      const data = await readApiData(response, McpActionDataSchema);
      if (data.snapshot !== undefined) {
        setMcpSnapshot(data.snapshot as McpSnapshotResponse);
      }
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setMcpRefreshing(false);
    }
  }, [
    authMode,
    bearerToken,
    oauthClientId,
    oauthClientSecret,
    oauthScope,
    serverId,
    serverName,
    serverUrl,
    setError,
  ]);

  const removeServer = useCallback(
    async (id: string): Promise<void> => {
      setMcpRefreshing(true);
      setError(null);
      try {
        const response = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove_server",
            id,
          }),
        });
        const data = await readApiData(response, McpActionDataSchema);
        if (data.snapshot !== undefined) {
          setMcpSnapshot(data.snapshot as McpSnapshotResponse);
        }
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setMcpRefreshing(false);
      }
    },
    [setError],
  );

  const beginOAuth = useCallback(
    async (id: string): Promise<void> => {
      setMcpRefreshing(true);
      setError(null);
      try {
        const response = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "begin_oauth",
            id,
          }),
        });
        const data = await readApiData(response, McpActionDataSchema);
        if (data.snapshot !== undefined) {
          setMcpSnapshot(data.snapshot as McpSnapshotResponse);
        }

        const authorizationUrl = data.authorizationUrl ?? "";

        if (authorizationUrl.length > 0) {
          window.location.assign(authorizationUrl);
        }
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setMcpRefreshing(false);
      }
    },
    [setError],
  );

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("mcp_oauth");
    const message = url.searchParams.get("message");
    if (!status) {
      return;
    }

    if (status === "error") {
      setError(message ?? "OAuth flow failed");
    }

    if (status === "success") {
      setError(null);
      void loadSnapshot(true);
    }

    url.searchParams.delete("mcp_oauth");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", url.toString());
  }, [loadSnapshot, setError]);

  return {
    mcpSnapshot,
    mcpLoading,
    mcpRefreshing,
    serverId,
    serverName,
    serverUrl,
    authMode,
    bearerToken,
    oauthScope,
    oauthClientId,
    oauthClientSecret,
    setServerId,
    setServerName,
    setServerUrl,
    setAuthMode,
    setBearerToken,
    setOauthScope,
    setOauthClientId,
    setOauthClientSecret,
    refreshMcp: async () => loadSnapshot(true),
    addServer,
    removeServer,
    beginOAuth,
  };
}

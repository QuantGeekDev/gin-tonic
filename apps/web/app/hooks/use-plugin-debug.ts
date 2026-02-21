"use client";

import { useCallback, useEffect, useState } from "react";
import type { PluginDebugResponse } from "../types/agent-api";
import { PluginDebugEnvelopeSchema } from "../types/agent-api";

export function usePluginDebug(setError: (value: string | null) => void): {
  pluginDebug: PluginDebugResponse | null;
  pluginLoading: boolean;
  pluginRefreshing: boolean;
  refreshPluginDebug: () => Promise<void>;
} {
  const [pluginDebug, setPluginDebug] = useState<PluginDebugResponse | null>(null);
  const [pluginLoading, setPluginLoading] = useState(true);
  const [pluginRefreshing, setPluginRefreshing] = useState(false);

  const refreshPluginDebug = useCallback(async (): Promise<void> => {
    setPluginRefreshing(true);
    try {
      const response = await fetch("/api/plugins", { cache: "no-store" });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error?: { message?: unknown } }).error?.message ?? "plugin debug failed")
            : "plugin debug failed";
        throw new Error(message);
      }
      const parsed = PluginDebugEnvelopeSchema.parse(body);
      setPluginDebug(parsed.data);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginLoading(false);
      setPluginRefreshing(false);
    }
  }, [setError]);

  useEffect(() => {
    void refreshPluginDebug();
  }, [refreshPluginDebug]);

  return {
    pluginDebug,
    pluginLoading,
    pluginRefreshing,
    refreshPluginDebug,
  };
}

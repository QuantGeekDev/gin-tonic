"use client";

import { useCallback, useEffect, useState } from "react";
import type { TelegramDebugResponse } from "../types/agent-api";
import { TelegramDebugDataSchema } from "../types/agent-api";
import { formatApiError, readApiData } from "../lib/agent-client";

export interface UseTelegramDebugResult {
  telegramDebug: TelegramDebugResponse | null;
  telegramLoading: boolean;
  telegramRefreshing: boolean;
  refreshTelegramDebug(): Promise<void>;
}

export function useTelegramDebug(
  setError: (error: string | null) => void,
): UseTelegramDebugResult {
  const [telegramDebug, setTelegramDebug] = useState<TelegramDebugResponse | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramRefreshing, setTelegramRefreshing] = useState(false);

  const load = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      if (forceRefresh) {
        setTelegramRefreshing(true);
      } else {
        setTelegramLoading(true);
      }
      setError(null);

      try {
        const response = await fetch("/api/telegram", { method: "GET" });
        const data = await readApiData(response, TelegramDebugDataSchema);
        setTelegramDebug(data as TelegramDebugResponse);
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setTelegramLoading(false);
        setTelegramRefreshing(false);
      }
    },
    [setError],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return {
    telegramDebug,
    telegramLoading,
    telegramRefreshing,
    refreshTelegramDebug: async () => load(true),
  };
}

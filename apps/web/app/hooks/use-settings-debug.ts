"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SettingsSnapshotResponse } from "../types/agent-api";
import { SettingsActionDataSchema, SettingsSnapshotDataSchema } from "../types/agent-api";
import { formatApiError, readApiData } from "../lib/agent-client";

export interface UseSettingsDebugResult {
  settingsSnapshot: SettingsSnapshotResponse | null;
  settingsLoading: boolean;
  settingsRefreshing: boolean;
  settingsSaving: boolean;
  selectedKey: string;
  draftValue: string;
  setSelectedKey(value: string): void;
  setDraftValue(value: string): void;
  refreshSettings(): Promise<void>;
  saveSetting(): Promise<void>;
  selectedDefinition: SettingsSnapshotResponse["definitions"][number] | null;
  selectedRecord: SettingsSnapshotResponse["values"][number] | null;
}

export function useSettingsDebug(
  setError: (error: string | null) => void,
): UseSettingsDebugResult {
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshotResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsRefreshing, setSettingsRefreshing] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const loadSnapshot = useCallback(
    async (refresh: boolean): Promise<void> => {
      if (refresh) {
        setSettingsRefreshing(true);
      } else {
        setSettingsLoading(true);
      }
      setError(null);
      try {
        const response = await fetch("/api/settings", { method: "GET" });
        const data = (await readApiData(
          response,
          SettingsSnapshotDataSchema,
        )) as SettingsSnapshotResponse;
        setSettingsSnapshot(data);
        if (data.definitions.length > 0 && selectedKey.length === 0) {
          const firstKey = data.definitions[0]?.key ?? "";
          setSelectedKey(firstKey);
          const currentValue = data.values.find((item) => item.key === firstKey)?.value ?? "";
          setDraftValue(currentValue);
        }
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setSettingsLoading(false);
        setSettingsRefreshing(false);
      }
    },
    [selectedKey.length, setError],
  );

  const saveSetting = useCallback(async (): Promise<void> => {
    if (selectedKey.trim().length === 0) {
      return;
    }
    setSettingsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: selectedKey,
          value: draftValue,
        }),
      });
      const data = await readApiData(response, SettingsActionDataSchema);
      if (data.snapshot !== undefined) {
        setSettingsSnapshot(data.snapshot as SettingsSnapshotResponse);
      }
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setSettingsSaving(false);
    }
  }, [draftValue, selectedKey, setError]);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const selectedDefinition = useMemo(() => {
    if (!settingsSnapshot) {
      return null;
    }
    return settingsSnapshot.definitions.find((item) => item.key === selectedKey) ?? null;
  }, [selectedKey, settingsSnapshot]);

  const selectedRecord = useMemo(() => {
    if (!settingsSnapshot) {
      return null;
    }
    return settingsSnapshot.values.find((item) => item.key === selectedKey) ?? null;
  }, [selectedKey, settingsSnapshot]);

  return {
    settingsSnapshot,
    settingsLoading,
    settingsRefreshing,
    settingsSaving,
    selectedKey,
    draftValue,
    setSelectedKey(value) {
      setSelectedKey(value);
      if (!settingsSnapshot) {
        return;
      }
      const existing = settingsSnapshot.values.find((item) => item.key === value);
      setDraftValue(existing?.value ?? "");
    },
    setDraftValue,
    refreshSettings: async () => loadSnapshot(true),
    saveSetting,
    selectedDefinition,
    selectedRecord,
  };
}


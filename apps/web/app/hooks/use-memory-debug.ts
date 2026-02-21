"use client";

import { useCallback, useState } from "react";
import type { MemoryResultItem } from "../types/agent-api";
import {
  MemorySaveDataSchema,
  MemorySearchDataSchema,
} from "../types/agent-api";
import { formatApiError, readApiData } from "../lib/agent-client";

export interface UseMemoryDebugResult {
  memoryQuery: string;
  memoryText: string;
  memoryNamespace: string;
  memoryTags: string;
  memoryLoading: boolean;
  memorySaving: boolean;
  memoryResults: MemoryResultItem[];
  setMemoryQuery(query: string): void;
  setMemoryText(text: string): void;
  setMemoryNamespace(namespace: string): void;
  setMemoryTags(tags: string): void;
  searchMemory(): Promise<void>;
  saveMemory(): Promise<void>;
}

export function useMemoryDebug(
  setError: (error: string | null) => void,
): UseMemoryDebugResult {
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryNamespace, setMemoryNamespace] = useState("global");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryResults, setMemoryResults] = useState<MemoryResultItem[]>([]);

  const searchMemory = useCallback(async (): Promise<void> => {
    const query = memoryQuery.trim();
    if (query.length === 0) {
      setMemoryResults([]);
      return;
    }

    setMemoryLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        query,
        namespace: memoryNamespace.trim(),
        limit: "20",
      });
      const response = await fetch(`/api/memory?${params.toString()}`);
      const data = await readApiData(response, MemorySearchDataSchema);
      setMemoryResults(data.results as MemoryResultItem[]);
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setMemoryLoading(false);
    }
  }, [memoryNamespace, memoryQuery, setError]);

  const saveMemory = useCallback(async (): Promise<void> => {
    const text = memoryText.trim();
    if (text.length === 0) {
      return;
    }

    setMemorySaving(true);
    setError(null);
    try {
      const parsedTags = memoryTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          namespace: memoryNamespace.trim().length > 0 ? memoryNamespace.trim() : undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        }),
      });
      await readApiData(response, MemorySaveDataSchema);
      setMemoryText("");
      await searchMemory();
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setMemorySaving(false);
    }
  }, [memoryNamespace, memoryTags, memoryText, searchMemory, setError]);

  return {
    memoryQuery,
    memoryText,
    memoryNamespace,
    memoryTags,
    memoryLoading,
    memorySaving,
    memoryResults,
    setMemoryQuery,
    setMemoryText,
    setMemoryNamespace,
    setMemoryTags,
    searchMemory,
    saveMemory,
  };
}

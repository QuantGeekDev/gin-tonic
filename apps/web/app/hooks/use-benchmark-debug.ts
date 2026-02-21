"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BenchmarkSnapshotResponse } from "../types/agent-api";
import { BenchmarkActionDataSchema, BenchmarkSnapshotDataSchema } from "../types/agent-api";
import { formatApiError, readApiData } from "../lib/agent-client";

export interface UseBenchmarkDebugResult {
  benchmarkSnapshot: BenchmarkSnapshotResponse | null;
  benchmarkLoading: boolean;
  benchmarkRefreshing: boolean;
  benchmarkRunning: boolean;
  benchmarkClearing: boolean;
  selectedScenario: string;
  samples: string;
  warmup: string;
  concurrency: string;
  label: string;
  payloadJson: string;
  setSelectedScenario(value: string): void;
  setSamples(value: string): void;
  setWarmup(value: string): void;
  setConcurrency(value: string): void;
  setLabel(value: string): void;
  setPayloadJson(value: string): void;
  refreshBenchmark(): Promise<void>;
  runBenchmark(): Promise<void>;
  clearBenchmark(): Promise<void>;
  latestRun: BenchmarkSnapshotResponse["runs"][number] | null;
}

function parseOptionalInt(rawValue: string): number | undefined {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function useBenchmarkDebug(setError: (error: string | null) => void): UseBenchmarkDebugResult {
  const [benchmarkSnapshot, setBenchmarkSnapshot] = useState<BenchmarkSnapshotResponse | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkRefreshing, setBenchmarkRefreshing] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkClearing, setBenchmarkClearing] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState("health.get");
  const [samples, setSamples] = useState("100");
  const [warmup, setWarmup] = useState("5");
  const [concurrency, setConcurrency] = useState("1");
  const [label, setLabel] = useState("");
  const [payloadJson, setPayloadJson] = useState("");

  const loadSnapshot = useCallback(
    async (refresh: boolean): Promise<void> => {
      if (refresh) {
        setBenchmarkRefreshing(true);
      } else {
        setBenchmarkLoading(true);
      }
      setError(null);
      try {
        const response = await fetch("/api/benchmark", { method: "GET" });
        const data = await readApiData(response, BenchmarkSnapshotDataSchema);
        setBenchmarkSnapshot(data);
        if (data.scenarios.length > 0 && !data.scenarios.some((scenario) => scenario.id === selectedScenario)) {
          setSelectedScenario(data.scenarios[0]?.id ?? "health.get");
        }
      } catch (requestError) {
        setError(formatApiError(requestError));
      } finally {
        setBenchmarkLoading(false);
        setBenchmarkRefreshing(false);
      }
    },
    [selectedScenario, setError],
  );

  const runBenchmark = useCallback(async (): Promise<void> => {
    if (selectedScenario.trim().length === 0) {
      return;
    }
    setBenchmarkRunning(true);
    setError(null);
    try {
      const parsedPayload = payloadJson.trim().length > 0 ? (JSON.parse(payloadJson) as unknown) : undefined;
      const response = await fetch("/api/benchmark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenario: selectedScenario,
          ...(parseOptionalInt(samples) !== undefined ? { samples: parseOptionalInt(samples) } : {}),
          ...(parseOptionalInt(warmup) !== undefined ? { warmup: parseOptionalInt(warmup) } : {}),
          ...(parseOptionalInt(concurrency) !== undefined
            ? { concurrency: parseOptionalInt(concurrency) }
            : {}),
          ...(label.trim().length > 0 ? { label: label.trim() } : {}),
          ...(parsedPayload !== undefined ? { payload: parsedPayload } : {}),
        }),
      });
      const data = await readApiData(response, BenchmarkActionDataSchema);
      if (data.snapshot !== undefined) {
        setBenchmarkSnapshot(data.snapshot as BenchmarkSnapshotResponse);
      } else {
        await loadSnapshot(true);
      }
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setBenchmarkRunning(false);
    }
  }, [concurrency, label, loadSnapshot, payloadJson, samples, selectedScenario, setError, warmup]);

  const clearBenchmark = useCallback(async (): Promise<void> => {
    setBenchmarkClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/benchmark", { method: "DELETE" });
      const data = await readApiData(response, BenchmarkActionDataSchema);
      if (data.snapshot !== undefined) {
        setBenchmarkSnapshot(data.snapshot as BenchmarkSnapshotResponse);
      } else {
        await loadSnapshot(true);
      }
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setBenchmarkClearing(false);
    }
  }, [loadSnapshot, setError]);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const latestRun = useMemo(() => {
    if (!benchmarkSnapshot || benchmarkSnapshot.runs.length === 0) {
      return null;
    }
    return benchmarkSnapshot.runs[0] ?? null;
  }, [benchmarkSnapshot]);

  return {
    benchmarkSnapshot,
    benchmarkLoading,
    benchmarkRefreshing,
    benchmarkRunning,
    benchmarkClearing,
    selectedScenario,
    samples,
    warmup,
    concurrency,
    label,
    payloadJson,
    setSelectedScenario,
    setSamples,
    setWarmup,
    setConcurrency,
    setLabel,
    setPayloadJson,
    refreshBenchmark: async () => loadSnapshot(true),
    runBenchmark,
    clearBenchmark,
    latestRun,
  };
}

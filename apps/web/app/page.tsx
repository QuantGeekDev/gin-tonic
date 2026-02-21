"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMessageContent } from "./lib/agent-client";
import { useAgentSession } from "./hooks/use-agent-session";
import { useMemoryDebug } from "./hooks/use-memory-debug";
import { useMcpDebug } from "./hooks/use-mcp-debug";
import { usePluginDebug } from "./hooks/use-plugin-debug";
import { useSettingsDebug } from "./hooks/use-settings-debug";
import { useTelegramDebug } from "./hooks/use-telegram-debug";
import { useBenchmarkDebug } from "./hooks/use-benchmark-debug";
import type { WebSessionScope } from "./types/agent-api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="outline" className="gap-1 rounded-full px-3 py-1 text-xs">
      {label}
      <span className="font-mono text-foreground">{value}</span>
    </Badge>
  );
}

const TTS_ENABLED_STORAGE_KEY = "jihn.tts.enabled";
const TTS_AUTOPLAY_STORAGE_KEY = "jihn.tts.autoplay";

function parseErrorWithRequestId(errorText: string): {
  message: string;
  requestId: string | null;
} {
  const match = /\(requestId:\s*([^)]+)\)\s*$/.exec(errorText);
  if (!match) {
    return { message: errorText, requestId: null };
  }
  return {
    message: errorText.replace(/\s*\(requestId:\s*([^)]+)\)\s*$/, "").trim(),
    requestId: match[1]?.trim() ?? null,
  };
}

export default function Home() {
  const [debugMode, setDebugMode] = useState(true);
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsAutoPlay, setTtsAutoPlay] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const lastAutoSpokenRef = useRef<string | null>(null);

  const {
    meta,
    messages,
    toolLog,
    peerId,
    scope,
    agentId,
    input,
    loading,
    debugLoading,
    error,
    usage,
    lastCompaction,
    lastTurn,
    simulation,
    setScope,
    setAgentId,
    setInput,
    setError,
    startNewSession,
    reloadMeta,
    sendMessage,
    simulateCompaction,
  } = useAgentSession();

  const {
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
  } = useMemoryDebug(setError);

  const {
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
    refreshMcp,
    addServer,
    removeServer,
    beginOAuth,
  } = useMcpDebug(setError);
  const {
    telegramDebug,
    telegramLoading,
    telegramRefreshing,
    refreshTelegramDebug,
  } = useTelegramDebug(setError);
  const {
    pluginDebug,
    pluginLoading,
    pluginRefreshing,
    refreshPluginDebug,
  } = usePluginDebug(setError);
  const {
    settingsSnapshot,
    settingsLoading,
    settingsRefreshing,
    settingsSaving,
    selectedKey,
    draftValue,
    selectedDefinition,
    selectedRecord,
    setSelectedKey,
    setDraftValue,
    refreshSettings,
    saveSetting,
  } = useSettingsDebug(setError);
  const {
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
    refreshBenchmark,
    runBenchmark,
    clearBenchmark,
    latestRun,
  } = useBenchmarkDebug(setError);

  const transcript = useMemo(() => {
    return messages.map((message) => ({
      role: message.role,
      text: renderMessageContent(message.content),
    }));
  }, [messages]);

  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!ttsEnabled || ttsSpeaking) {
        return;
      }
      const normalized = text.trim();
      if (normalized.length === 0) {
        return;
      }

      setTtsSpeaking(true);
      setTtsError(null);
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: normalized }),
        });
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(errorBody?.error?.message ?? `TTS request failed (${response.status})`);
        }

        const audioBlob = await response.blob();
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Audio playback failed."));
          };
          void audio.play().catch((error: unknown) => {
            URL.revokeObjectURL(url);
            reject(error);
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTtsError(message);
        setError(`TTS failed: ${message}`);
      } finally {
        setTtsSpeaking(false);
      }
    },
    [setError, ttsEnabled, ttsSpeaking],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("jihn.debugMode");
    setDebugMode(stored !== "false");
    setTtsEnabled(window.localStorage.getItem(TTS_ENABLED_STORAGE_KEY) === "true");
    setTtsAutoPlay(window.localStorage.getItem(TTS_AUTOPLAY_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (!ttsEnabled || !ttsAutoPlay || loading || ttsSpeaking) {
      return;
    }
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) {
      return;
    }
    const text = renderMessageContent(lastAssistant.content).trim();
    if (text.length === 0 || lastAutoSpokenRef.current === text) {
      return;
    }
    lastAutoSpokenRef.current = text;
    void speakText(text);
  }, [loading, messages, speakText, ttsAutoPlay, ttsEnabled, ttsSpeaking]);

  const toggleDebugMode = (): void => {
    setDebugMode((current) => {
      const next = !current;
      window.localStorage.setItem("jihn.debugMode", String(next));
      return next;
    });
  };

  const toggleTtsEnabled = (): void => {
    setTtsEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(TTS_ENABLED_STORAGE_KEY, String(next));
      if (!next) {
        setTtsAutoPlay(false);
        window.localStorage.setItem(TTS_AUTOPLAY_STORAGE_KEY, "false");
      }
      return next;
    });
  };

  const toggleTtsAutoPlay = (): void => {
    setTtsAutoPlay((current) => {
      const next = !current;
      window.localStorage.setItem(TTS_AUTOPLAY_STORAGE_KEY, String(next));
      return next;
    });
  };

  const parsedError = useMemo(() => {
    if (!error) {
      return null;
    }
    return parseErrorWithRequestId(error);
  }, [error]);

  const copyRequestId = async (requestId: string): Promise<void> => {
    await navigator.clipboard.writeText(requestId);
    setCopiedRequestId(requestId);
    window.setTimeout(() => {
      setCopiedRequestId((current) => (current === requestId ? null : current));
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex h-screen max-w-[1550px] flex-col gap-4 p-4">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl">Jihn Control Center</CardTitle>
                <CardDescription>
                  Unified chat workspace with operational debugging controls.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Button
                  variant={debugMode ? "default" : "outline"}
                  size="sm"
                  onClick={toggleDebugMode}
                >
                  Debug Mode {debugMode ? "On" : "Off"}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="provider" value={meta?.provider ?? "loading"} />
              <StatusPill label="model" value={meta?.model ?? "loading"} />
              <StatusPill label="scope" value={scope} />
              <StatusPill label="turns" value={String(Math.floor(messages.length / 2))} />
            </div>
          </CardHeader>
        </Card>

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
          <Card className="min-h-0 overflow-hidden">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Conversation</CardTitle>
                  <CardDescription>Session transcript and assistant responses</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void reloadMeta()}>
                    Refresh Runtime
                  </Button>
                  <Button variant="outline" size="sm" onClick={startNewSession}>
                    New Session
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
                {transcript.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                      No conversation yet. Send a message to begin.
                    </CardContent>
                  </Card>
                ) : (
                  transcript.map((line, index) => {
                    const isUser = line.role === "user";
                    return (
                      <div
                        key={`${line.role}-${index}`}
                        className={`max-w-[86%] rounded-xl border px-4 py-3 text-sm leading-6 shadow-sm ${
                          isUser
                            ? "ml-auto border-primary/40 bg-primary/10"
                            : "mr-auto border-border bg-card"
                        }`}
                      >
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {line.role}
                        </p>
                        {!isUser && ttsEnabled ? (
                          <div className="mb-2 flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => void speakText(line.text)}
                              disabled={ttsSpeaking || loading}
                            >
                              {ttsSpeaking ? "Speaking..." : "Speak"}
                            </Button>
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap">{line.text}</p>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t p-4">
                <Textarea
                  className="h-28 resize-none"
                  placeholder="Ask Jihn anything. Example: summarize the last decision with risks and actions."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter newline</p>
                  <Button onClick={() => void sendMessage()} disabled={loading}>
                    {loading ? "Running Turn..." : "Send"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <aside className="min-h-0 overflow-y-auto">
            <div className="space-y-4 pr-1">
              <Card>
                <CardHeader>
                  <CardTitle>Runtime Control</CardTitle>
                  <CardDescription>Session scope and agent routing context</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="block text-xs text-muted-foreground">
                    Scope
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                      value={scope}
                      onChange={(event) => setScope(event.target.value as WebSessionScope)}
                    >
                      <option value="peer">peer</option>
                      <option value="channel-peer">channel-peer</option>
                      <option value="global">global</option>
                    </select>
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Agent ID
                    <Input value={agentId} onChange={(event) => setAgentId(event.target.value)} />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Peer ID
                    <Input value={peerId} readOnly className="bg-muted" />
                  </label>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Voice Output</CardTitle>
                  <CardDescription>Dashboard text-to-speech mode</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <Button variant={ttsEnabled ? "default" : "outline"} size="sm" onClick={toggleTtsEnabled}>
                      {ttsEnabled ? "TTS On" : "TTS Off"}
                    </Button>
                    <Button
                      variant={ttsAutoPlay ? "default" : "outline"}
                      size="sm"
                      onClick={toggleTtsAutoPlay}
                      disabled={!ttsEnabled}
                    >
                      Auto-play {ttsAutoPlay ? "On" : "Off"}
                    </Button>
                  </div>
                  <p>provider route: /api/tts</p>
                  <p>state: {ttsSpeaking ? "speaking" : "idle"}</p>
                  {ttsError ? <p className="text-destructive">error: {ttsError}</p> : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Turn Debug</CardTitle>
                  <CardDescription>Latest request metrics and runtime state</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  <p>est_in {usage.estimatedInputTokens} | in {usage.inputTokens} | out {usage.outputTokens}</p>
                  <p>latency: {lastTurn ? `${lastTurn.latencyMs}ms` : "-"}</p>
                  <p>persistence: {lastTurn?.persistenceMode ?? "-"}</p>
                  <p>idempotency hit: {lastTurn ? String(lastTurn.idempotencyHit) : "-"}</p>
                  <p className="break-all">session key: {lastTurn?.session.sessionKey ?? "-"}</p>
                  {lastTurn ? <p>completed: {lastTurn.completedAt}</p> : null}
                  {parsedError ? (
                    <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                      <p>{parsedError.message}</p>
                      {parsedError.requestId
                        ? (() => {
                            const requestId = parsedError.requestId;
                            return (
                              <div className="mt-2 flex items-center gap-2">
                                <code className="rounded bg-background/60 px-2 py-1 text-[11px] text-destructive">
                                  requestId: {requestId}
                                </code>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 border-destructive/40 px-2 text-[11px]"
                                  onClick={() => void copyRequestId(requestId)}
                                >
                                  {copiedRequestId === requestId ? "Copied" : "Copy ID"}
                                </Button>
                              </div>
                            );
                          })()
                        : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {debugMode ? (
                <>
                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>Compaction Lab</CardTitle>
                        <CardDescription>Compare compaction output across channels</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" disabled={debugLoading} onClick={() => void simulateCompaction()}>
                        {debugLoading ? "Simulating..." : "Simulate"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs text-muted-foreground">
                      {lastCompaction ? (
                        <>
                          <p>last turn: {lastCompaction.compacted ? "compacted" : "not compacted"}</p>
                          <p>strategy: {lastCompaction.strategy}</p>
                          <p>tokens: {lastCompaction.beforeTokens} {"->"} {lastCompaction.afterTokens}</p>
                          <p>messages: {lastCompaction.beforeMessageCount} {"->"} {lastCompaction.afterMessageCount}</p>
                        </>
                      ) : (
                        <p>No compaction run yet.</p>
                      )}
                      {simulation ? (
                        <Card className="mt-2 bg-muted/40">
                          <CardContent className="p-3">
                            <p>cross-channel identical: {String(simulation.identical)}</p>
                            <p>web: {simulation.web.beforeTokens} {"->"} {simulation.web.afterTokens} ({simulation.web.strategy})</p>
                            {simulation.cli ? (
                              <p>cli: {simulation.cli.beforeTokens} {"->"} {simulation.cli.afterTokens} ({simulation.cli.strategy})</p>
                            ) : null}
                          </CardContent>
                        </Card>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>Runtime Settings</CardTitle>
                        <CardDescription>Allowlisted gateway settings persisted via control plane</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={settingsRefreshing}
                        onClick={() => void refreshSettings()}
                      >
                        {settingsRefreshing ? "Refreshing..." : "Refresh"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      {settingsLoading ? <p>Loading runtime settings...</p> : null}
                      {settingsSnapshot ? (
                        <>
                          <p>settings file: {settingsSnapshot.settingsFilePath}</p>
                          <p>snapshot: {settingsSnapshot.generatedAt}</p>
                          <p>
                            precedence: {settingsSnapshot.precedenceMode ?? "runtime_over_env"}
                          </p>
                          <label className="block">
                            <span className="mb-1 block">Key</span>
                            <select
                              className="h-10 w-full rounded-md border border-input bg-background px-2"
                              value={selectedKey}
                              onChange={(event) => setSelectedKey(event.target.value)}
                            >
                              {settingsSnapshot.definitions.map((definition) => (
                                <option key={definition.key} value={definition.key}>
                                  {definition.key}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block">Value</span>
                            <Input
                              value={draftValue}
                              onChange={(event) => setDraftValue(event.target.value)}
                              placeholder="new value"
                            />
                          </label>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void saveSetting()} disabled={settingsSaving}>
                              {settingsSaving ? "Saving..." : "Save Setting"}
                            </Button>
                          </div>
                          {selectedDefinition ? (
                            <Card className="bg-muted/40">
                              <CardContent className="p-3">
                                <p className="font-mono">{selectedDefinition.key}</p>
                                <p>category: {selectedDefinition.category}</p>
                                <p>apply mode: {selectedDefinition.applyMode}</p>
                                <p>{selectedDefinition.description}</p>
                                <p>
                                  current:{" "}
                                  <span className="font-mono">
                                    {selectedRecord?.value ?? "(unset)"}
                                  </span>
                                </p>
                                <p>
                                  source:{" "}
                                  {selectedRecord?.updatedBy === "env"
                                    ? "environment"
                                    : selectedRecord?.updatedBy ?? "(none)"}
                                </p>
                              </CardContent>
                            </Card>
                          ) : null}
                        </>
                      ) : (
                        <p>No settings snapshot available.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>Benchmark Lab</CardTitle>
                        <CardDescription>Gateway latency and throughput benchmarking</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={benchmarkRefreshing}
                        onClick={() => void refreshBenchmark()}
                      >
                        {benchmarkRefreshing ? "Refreshing..." : "Refresh"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      {benchmarkLoading ? <p>Loading benchmark snapshot...</p> : null}
                      {benchmarkSnapshot ? (
                        <>
                          <p>snapshot: {benchmarkSnapshot.generatedAt}</p>
                          <p>stored runs: {benchmarkSnapshot.runs.length}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block">Scenario</span>
                              <select
                                className="h-10 w-full rounded-md border border-input bg-background px-2"
                                value={selectedScenario}
                                onChange={(event) => setSelectedScenario(event.target.value)}
                              >
                                {benchmarkSnapshot.scenarios.map((scenario) => (
                                  <option key={scenario.id} value={scenario.id}>
                                    {scenario.id}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="mb-1 block">Label</span>
                              <Input
                                placeholder="node-gateway"
                                value={label}
                                onChange={(event) => setLabel(event.target.value)}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block">Samples</span>
                              <Input value={samples} onChange={(event) => setSamples(event.target.value)} />
                            </label>
                            <label className="block">
                              <span className="mb-1 block">Warmup</span>
                              <Input value={warmup} onChange={(event) => setWarmup(event.target.value)} />
                            </label>
                            <label className="block">
                              <span className="mb-1 block">Concurrency</span>
                              <Input
                                value={concurrency}
                                onChange={(event) => setConcurrency(event.target.value)}
                              />
                            </label>
                          </div>
                          <label className="block">
                            <span className="mb-1 block">Payload JSON (optional)</span>
                            <Textarea
                              className="h-20 resize-none"
                              placeholder='{"text":"Reply with one word OK"}'
                              value={payloadJson}
                              onChange={(event) => setPayloadJson(event.target.value)}
                            />
                          </label>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={benchmarkRunning} onClick={() => void runBenchmark()}>
                              {benchmarkRunning ? "Running..." : "Run Benchmark"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={benchmarkClearing}
                              onClick={() => void clearBenchmark()}
                            >
                              {benchmarkClearing ? "Clearing..." : "Clear Results"}
                            </Button>
                          </div>
                          {latestRun ? (
                            <Card className="bg-muted/40">
                              <CardContent className="p-3">
                                <p className="font-mono">
                                  {latestRun.scenario} [{latestRun.label}]
                                </p>
                                <p>
                                  ok/fail: {latestRun.summary.successfulRequests}/
                                  {latestRun.summary.failedRequests} | total: {latestRun.summary.totalRequests}
                                </p>
                                <p>
                                  duration: {latestRun.summary.totalDurationMs.toFixed(2)}ms | throughput:{" "}
                                  {latestRun.summary.throughputRps.toFixed(2)} rps
                                </p>
                                <p>
                                  p50/p95/p99: {latestRun.summary.p50Ms?.toFixed(2) ?? "n/a"} /{" "}
                                  {latestRun.summary.p95Ms?.toFixed(2) ?? "n/a"} /{" "}
                                  {latestRun.summary.p99Ms?.toFixed(2) ?? "n/a"} ms
                                </p>
                                {latestRun.errors.length > 0 ? (
                                  <p>errors captured: {latestRun.errors.length}</p>
                                ) : null}
                              </CardContent>
                            </Card>
                          ) : (
                            <p>No benchmark run yet.</p>
                          )}
                        </>
                      ) : (
                        <p>No benchmark snapshot available.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Tool Trace</CardTitle>
                      <CardDescription>Recent tool calls and outputs</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                        {toolLog.length === 0 ? (
                          <p>No tool events.</p>
                        ) : (
                          <ul className="space-y-1">
                            {toolLog.slice(-30).map((line, index) => (
                              <li key={`${line}-${index}`} className="break-all">{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>Plugin Runtime</CardTitle>
                        <CardDescription>Loaded plugins, lifecycle health, and events</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pluginRefreshing}
                        onClick={() => void refreshPluginDebug()}
                      >
                        {pluginRefreshing ? "Refreshing..." : "Refresh"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      {pluginLoading ? <p>Loading plugin runtime snapshot...</p> : null}
                      {pluginDebug ? (
                        <>
                          <p>plugins: {pluginDebug.plugins.length}</p>
                          <p>events captured: {pluginDebug.events.length}</p>
                          <div className="space-y-2">
                            {pluginDebug.plugins.map((plugin) => {
                              const status = pluginDebug.statuses.find(
                                (item) => item.pluginId === plugin.id,
                              );
                              const health = pluginDebug.health[plugin.id];
                              return (
                                <Card key={plugin.id} className="bg-muted/40">
                                  <CardContent className="p-3">
                                    <p className="font-mono">
                                      {plugin.id} v{plugin.version}
                                    </p>
                                    <p>
                                      state: {status?.state ?? "unknown"} | healthy:{" "}
                                      {String(health?.healthy ?? false)}
                                    </p>
                                    <p>
                                      capabilities: {plugin.capabilities.join(", ") || "(none)"}
                                    </p>
                                    <p>
                                      permissions: {plugin.permissions?.join(", ") || "(none)"}
                                    </p>
                                    {status?.lastError ? <p>error: {status.lastError}</p> : null}
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2">
                            {pluginDebug.events.length === 0 ? (
                              <p>No plugin events recorded.</p>
                            ) : (
                              <ul className="space-y-1">
                                {pluginDebug.events
                                  .slice(-40)
                                  .reverse()
                                  .map((event, index) => (
                                    <li
                                      key={`${event.timestamp}-${event.pluginId}-${index}`}
                                      className="break-all"
                                    >
                                      [{event.name}] {event.pluginId} @ {event.timestamp}
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>
                        </>
                      ) : (
                        <p>No plugin snapshot available.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>Telegram Adapter</CardTitle>
                        <CardDescription>Health and recent channel delivery events</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={telegramRefreshing}
                        onClick={() => void refreshTelegramDebug()}
                      >
                        {telegramRefreshing ? "Refreshing..." : "Refresh"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      {telegramLoading ? <p>Loading telegram adapter snapshot...</p> : null}
                      {telegramDebug ? (
                        <>
                          <p>
                            status: {telegramDebug.running ? "running" : "stopped"} | mode:{" "}
                            {telegramDebug.transportMode}
                          </p>
                          <p>
                            received: {telegramDebug.stats.received} | replied:{" "}
                            {telegramDebug.stats.replied} | failed: {telegramDebug.stats.failed}
                          </p>
                          <p>
                            blocked: {telegramDebug.stats.blocked} | retries:{" "}
                            {telegramDebug.stats.retries} | queue: {telegramDebug.outbound.queueDepth} | processing:{" "}
                            {telegramDebug.outbound.processing} | retry: {telegramDebug.outbound.retryDepth} | dead:{" "}
                            {telegramDebug.outbound.deadLetterDepth}
                          </p>
                          <p>snapshot: {telegramDebug.generatedAt}</p>
                          <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/30 p-2">
                            {telegramDebug.recentEvents.length === 0 ? (
                              <p>No events recorded.</p>
                            ) : (
                              <ul className="space-y-1">
                                {telegramDebug.recentEvents.slice(0, 40).map((event, index) => (
                                  <li key={`${event.timestamp}-${event.event}-${index}`} className="break-all">
                                    [{event.level}] {event.event} @ {event.timestamp}
                                    {event.updateId !== undefined ? ` | update:${event.updateId}` : ""}
                                    {event.chatId !== undefined ? ` | chat:${event.chatId}` : ""}
                                    {event.detail ? ` | ${event.detail}` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      ) : (
                        <p>No telegram adapter snapshot found.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle>MCP Inspector</CardTitle>
                        <CardDescription>Add/authenticate remote HTTP MCP servers</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" disabled={mcpRefreshing} onClick={() => void refreshMcp()}>
                        {mcpRefreshing ? "Refreshing..." : "Refresh"}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      {mcpLoading ? <p>Loading MCP snapshot...</p> : null}
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="server id" value={serverId} onChange={(event) => setServerId(event.target.value)} />
                        <Input placeholder="display name" value={serverName} onChange={(event) => setServerName(event.target.value)} />
                        <Input className="col-span-2" placeholder="https://server.example.com/mcp" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
                        <select
                          className="h-10 rounded-md border border-input bg-background px-2"
                          value={authMode}
                          onChange={(event) => setAuthMode(event.target.value as "none" | "bearer" | "oauth2")}
                        >
                          <option value="none">no auth</option>
                          <option value="bearer">bearer token</option>
                          <option value="oauth2">oauth2 (DCR/non-DCR)</option>
                        </select>
                        {authMode === "bearer" ? (
                          <Input
                            placeholder="Bearer token"
                            value={bearerToken}
                            onChange={(event) => setBearerToken(event.target.value)}
                          />
                        ) : null}
                        {authMode === "oauth2" ? (
                          <>
                            <Input
                              placeholder="scope (optional)"
                              value={oauthScope}
                              onChange={(event) => setOauthScope(event.target.value)}
                            />
                            <Input
                              className="col-span-2"
                              placeholder="client id (optional; needed for non-DCR servers)"
                              value={oauthClientId}
                              onChange={(event) => setOauthClientId(event.target.value)}
                            />
                            <Input
                              className="col-span-2"
                              placeholder="client secret (optional)"
                              value={oauthClientSecret}
                              onChange={(event) => setOauthClientSecret(event.target.value)}
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => void addServer()}>
                          Save Server
                        </Button>
                        {authMode === "oauth2" ? (
                          <Button size="sm" onClick={() => void beginOAuth(serverId)}>
                            OAuth Connect
                          </Button>
                        ) : null}
                      </div>

                      {mcpSnapshot ? (
                        <>
                          <p>snapshot: {mcpSnapshot.generatedAt}</p>
                          <p>servers: {mcpSnapshot.servers.length}</p>
                          <p>tools: {mcpSnapshot.tools.length}</p>
                          <div className="space-y-2">
                            {mcpSnapshot.servers.map((server) => (
                              <Card key={server.id} className="bg-muted/40">
                                <CardContent className="p-3">
                                  <p className="font-mono">
                                    {server.name ?? server.id} ({server.connected ? "connected" : "disconnected"})
                                  </p>
                                  <p className="break-all">{server.url}</p>
                                  <p>auth: {server.authMode} ({server.authorized ? "authorized" : "not authorized"})</p>
                                  <p>tools: {server.toolCount}</p>
                                  {server.error
                                    ? (() => {
                                        const parsedServerError = parseErrorWithRequestId(server.error);
                                        return (
                                          <div className="mt-1 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                                            <p>error: {parsedServerError.message}</p>
                                            {parsedServerError.requestId
                                              ? (() => {
                                                  const requestId = parsedServerError.requestId;
                                                  return (
                                                    <div className="mt-2 flex items-center gap-2">
                                                      <code className="rounded bg-background/60 px-2 py-1 text-[11px] text-destructive">
                                                        requestId: {requestId}
                                                      </code>
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 border-destructive/40 px-2 text-[11px]"
                                                        onClick={() => void copyRequestId(requestId)}
                                                      >
                                                        {copiedRequestId === requestId ? "Copied" : "Copy ID"}
                                                      </Button>
                                                    </div>
                                                  );
                                                })()
                                              : null}
                                          </div>
                                        );
                                      })()
                                    : null}
                                  <div className="mt-2 flex gap-2">
                                    {server.authMode === "oauth2" ? (
                                      <Button size="sm" variant="outline" onClick={() => void beginOAuth(server.id)}>
                                        OAuth Connect
                                      </Button>
                                    ) : null}
                                    <Button size="sm" variant="destructive" onClick={() => void removeServer(server.id)}>
                                      Remove
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                          <div className="mt-3 rounded-md border bg-muted/30 p-2">
                            <p className="mb-1 font-medium">Exposed tools</p>
                            {mcpSnapshot.tools.length === 0 ? (
                              <p>No tools discovered.</p>
                            ) : (
                              <ul className="space-y-1">
                                {mcpSnapshot.tools.map((tool) => (
                                  <li key={tool.exposedName} className="break-all">
                                    <span className="font-mono">{tool.exposedName}</span>
                                    {" <- "}
                                    {tool.serverId}.{tool.remoteName}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      ) : (
                        <p>No MCP snapshot available.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Memory Lab</CardTitle>
                      <CardDescription>Write and query long-term memory</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <label className="block text-muted-foreground">
                        Namespace
                        <Input value={memoryNamespace} onChange={(event) => setMemoryNamespace(event.target.value)} />
                      </label>
                      <label className="block text-muted-foreground">
                        Save memory
                        <Textarea
                          className="h-20 resize-none"
                          placeholder="User prefers concise responses and examples."
                          value={memoryText}
                          onChange={(event) => setMemoryText(event.target.value)}
                        />
                      </label>
                      <label className="block text-muted-foreground">
                        Tags
                        <Input
                          placeholder="preference, style"
                          value={memoryTags}
                          onChange={(event) => setMemoryTags(event.target.value)}
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={memorySaving} onClick={() => void saveMemory()}>
                          {memorySaving ? "Saving..." : "Save"}
                        </Button>
                        <Input
                          className="flex-1"
                          placeholder="Search memory"
                          value={memoryQuery}
                          onChange={(event) => setMemoryQuery(event.target.value)}
                        />
                        <Button size="sm" variant="outline" disabled={memoryLoading} onClick={() => void searchMemory()}>
                          {memoryLoading ? "Searching..." : "Search"}
                        </Button>
                      </div>
                      <div className="max-h-44 overflow-y-auto rounded-md border bg-muted/30 p-2 text-muted-foreground">
                        {memoryResults.length === 0 ? (
                          <p>No memory results yet.</p>
                        ) : (
                          <ul className="space-y-2">
                            {memoryResults.map((item) => (
                              <li key={item.id} className="rounded-md border bg-card p-2">
                                <p className="font-mono text-[11px]">{item.namespace} · score {item.score}</p>
                                <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
                                <p className="mt-1 text-[11px] text-muted-foreground">{item.createdAt}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="p-4 text-xs text-muted-foreground">
                    Debug mode is off. Turn it on from the header to access compaction, MCP, tool trace, and memory labs.
                  </CardContent>
                </Card>
              )}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

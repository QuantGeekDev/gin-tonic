"use client";

import { useCallback, useEffect, useState } from "react";
import type { Message } from "@jihn/agent-core";
import type {
  AgentMetaResponse,
  AgentTurnResponse,
  CompactionSimulationResponse,
  TokenUsage,
  WebSessionScope,
} from "../types/agent-api";
import {
  AgentMetaDataSchema,
  AgentTurnDataSchema,
  CompactionSimulationDataSchema,
} from "../types/agent-api";
import {
  createPeerId,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TURNS,
  formatApiError,
  PEER_ID_STORAGE_KEY,
  readApiData,
} from "../lib/agent-client";

const INITIAL_USAGE: TokenUsage = {
  estimatedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
};

export interface UseAgentSessionResult {
  meta: AgentMetaResponse | null;
  messages: Message[];
  toolLog: string[];
  peerId: string;
  scope: WebSessionScope;
  agentId: string;
  input: string;
  loading: boolean;
  debugLoading: boolean;
  error: string | null;
  usage: TokenUsage;
  lastCompaction: AgentTurnResponse["compaction"];
  lastTurn: {
    provider: string;
    model: string;
    session: AgentTurnResponse["session"];
    persistenceMode: AgentTurnResponse["persistenceMode"];
    idempotencyHit: boolean;
    latencyMs: number;
    completedAt: string;
  } | null;
  simulation: CompactionSimulationResponse["simulation"] | null;
  setScope(scope: WebSessionScope): void;
  setAgentId(agentId: string): void;
  setInput(input: string): void;
  setError(error: string | null): void;
  startNewSession(): void;
  reloadMeta(): Promise<void>;
  sendMessage(): Promise<void>;
  simulateCompaction(): Promise<void>;
}

export function useAgentSession(): UseAgentSessionResult {
  const [meta, setMeta] = useState<AgentMetaResponse | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("web-user");
  const [scope, setScope] = useState<WebSessionScope>("channel-peer");
  const [agentId, setAgentId] = useState("main");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage>(INITIAL_USAGE);
  const [lastCompaction, setLastCompaction] = useState<AgentTurnResponse["compaction"]>(null);
  const [lastTurn, setLastTurn] = useState<UseAgentSessionResult["lastTurn"]>(null);
  const [simulation, setSimulation] = useState<CompactionSimulationResponse["simulation"] | null>(
    null,
  );

  const loadMeta = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/agent", { method: "GET" });
    const data = await readApiData(response, AgentMetaDataSchema);
    setMeta(data as AgentMetaResponse);
  }, []);

  const startNewSession = useCallback((): void => {
    const nextPeer = createPeerId();
    window.localStorage.setItem(PEER_ID_STORAGE_KEY, nextPeer);
    setPeerId(nextPeer);
    setMessages([]);
    setToolLog([]);
    setUsage(INITIAL_USAGE);
    setLastCompaction(null);
    setLastTurn(null);
    setSimulation(null);
    setError(null);
  }, []);

  const sendMessage = useCallback(async (): Promise<void> => {
    const trimmed = input.trim();
    if (trimmed.length === 0 || loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startedAt = performance.now();
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          peerId,
          scope,
          agentId,
          channelId: "web",
          maxTurns: DEFAULT_MAX_TURNS,
          maxTokens: DEFAULT_MAX_TOKENS,
        }),
      });

      const turn = (await readApiData(
        response,
        AgentTurnDataSchema,
      )) as AgentTurnResponse;

      setMessages(turn.messages as Message[]);
      setUsage(turn.usage);
      setLastCompaction(turn.compaction);
      setLastTurn({
        provider: turn.provider,
        model: turn.model,
        session: turn.session,
        persistenceMode: turn.persistenceMode,
        idempotencyHit: turn.idempotencyHit === true,
        latencyMs: Math.round(performance.now() - startedAt),
        completedAt: new Date().toISOString(),
      });
      setToolLog((prev) => [
        ...prev,
        ...turn.toolEvents.map((event: AgentTurnResponse["toolEvents"][number]) =>
          event.kind === "call"
            ? `TOOL CALL ${event.name}: ${JSON.stringify(event.input)}`
            : `TOOL RESULT ${event.name}: ${event.output}`,
        ),
      ]);
      setInput("");
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [agentId, input, loading, peerId, scope]);

  const simulateCompaction = useCallback(async (): Promise<void> => {
    const trimmed = input.trim();
    const simulationText =
      trimmed.length > 0 ? trimmed : "simulate compaction with current session";
    setDebugLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: simulationText,
          peerId,
          scope,
          agentId,
          channelId: "web",
          maxTurns: DEFAULT_MAX_TURNS,
          maxTokens: DEFAULT_MAX_TOKENS,
          debug: {
            simulateCompaction: true,
            compareChannels: true,
          },
        }),
      });

      const data = (await readApiData(
        response,
        CompactionSimulationDataSchema,
      )) as CompactionSimulationResponse;
      setSimulation(data.simulation);
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setDebugLoading(false);
    }
  }, [agentId, input, peerId, scope]);

  useEffect(() => {
    const storedPeerId = window.localStorage.getItem(PEER_ID_STORAGE_KEY)?.trim();
    if (storedPeerId && storedPeerId.length > 0) {
      setPeerId(storedPeerId);
      return;
    }
    const generated = createPeerId();
    window.localStorage.setItem(PEER_ID_STORAGE_KEY, generated);
    setPeerId(generated);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  return {
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
    reloadMeta: loadMeta,
    sendMessage,
    simulateCompaction,
  };
}

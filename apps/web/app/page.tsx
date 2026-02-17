"use client";

import { useEffect, useMemo, useState } from "react";
import type { Message } from "@jihn/agent-core";

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_TOKENS = 1024;

interface ToolMeta {
  name: string;
  description: string;
}

interface AgentMetaResponse {
  model: string;
  tools: ToolMeta[];
}

interface AgentTurnResponse {
  text: string;
  messages: Message[];
  usage: {
    estimatedInputTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
  toolEvents: Array<
    | { kind: "call"; name: string; input: Record<string, unknown> }
    | { kind: "result"; name: string; output: string }
  >;
  model: string;
  session: {
    agentId: string;
    scope: string;
    channelId: string;
    peerId: string;
    sessionKey: string;
  };
  persistenceMode: "append" | "save";
}

const PEER_ID_STORAGE_KEY = "jihn.peerId";

function createPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now()}`;
}

function renderMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "tool_use") {
        return `🔧 ${block.name} ${JSON.stringify(block.input)}`;
      }
      if (block.type === "tool_result") {
        return `→ ${block.content}`;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

export default function Home() {
  const [meta, setMeta] = useState<AgentMetaResponse | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [peerId, setPeerId] = useState("web-user");
  const [scope, setScope] = useState<"peer" | "channel-peer" | "global">("peer");
  const [agentId, setAgentId] = useState("main");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({
    estimatedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  });

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

  const startNewSession = (): void => {
    const nextPeer = createPeerId();
    window.localStorage.setItem(PEER_ID_STORAGE_KEY, nextPeer);
    setPeerId(nextPeer);
    setMessages([]);
    setToolLog([]);
    setUsage({
      estimatedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    setError(null);
  };

  useEffect(() => {
    const loadMeta = async (): Promise<void> => {
      const response = await fetch("/api/agent", { method: "GET" });
      const json = (await response.json()) as AgentMetaResponse;
      setMeta(json);
    };

    void loadMeta();
  }, []);

  const transcript = useMemo(() => {
    return messages.map((message) => ({
      role: message.role,
      text: renderMessageContent(message.content),
    }));
  }, [messages]);

  const sendMessage = async (): Promise<void> => {
    const trimmed = input.trim();
    if (trimmed.length === 0 || loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
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

      const json = (await response.json()) as AgentTurnResponse | { error: string };
      if (!response.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${response.status}`);
      }

      setMessages(json.messages);
      setUsage(json.usage);
      setToolLog((prev) => [
        ...prev,
        ...json.toolEvents.map((event) =>
          event.kind === "call"
            ? `🔧 ${event.name}: ${JSON.stringify(event.input)}`
            : `→ ${event.name}: ${event.output}`,
        ),
      ]);
      setInput("");
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#19313a,_transparent_40%),radial-gradient(circle_at_bottom_right,_#40221f,_transparent_35%),linear-gradient(145deg,_#0f1418,_#111f26_45%,_#1e1613)] text-zinc-100">
      <main className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4">
        <header className="rounded-2xl border border-cyan-300/30 bg-black/30 px-5 py-4 backdrop-blur">
          <h1 className="font-mono text-2xl tracking-wide text-cyan-200">Jihn Dashboard</h1>
          <p className="text-sm text-zinc-300">
            Local operator console for the Jihn agent loop
          </p>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/15 bg-black/35 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-cyan-100">
                Scrollback
              </h2>
              <button
                className="rounded-md border border-white/20 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10"
                onClick={startNewSession}
              >
                Clear + New Session
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {transcript.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No messages yet. Ask a question to start a turn.
                </p>
              ) : (
                <div className="space-y-3">
                  {transcript.map((line, index) => (
                    <div
                      key={`${line.role}-${index}`}
                      className="rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-zinc-400">
                        {line.role}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                        {line.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-white/10 p-4">
              <textarea
                className="h-28 w-full resize-none rounded-xl border border-cyan-400/30 bg-black/40 p-3 text-sm text-zinc-100 outline-none ring-cyan-300/50 placeholder:text-zinc-500 focus:ring-2"
                placeholder="Ask Jihn anything. Example: What's 1337 * 42?"
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
                <p className="text-xs text-zinc-400">Enter to send, Shift+Enter newline</p>
                <button
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={loading}
                  onClick={() => {
                    void sendMessage();
                  }}
                >
                  {loading ? "Running..." : "Send"}
                </button>
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-white/15 bg-black/35 p-4 backdrop-blur">
              <h3 className="mb-2 font-mono text-sm uppercase tracking-[0.2em] text-amber-200">
                Operator
              </h3>
              <p className="text-sm text-zinc-200">
                Model: <span className="font-mono text-cyan-200">{meta?.model ?? "..."}</span>
              </p>
              <p className="text-sm text-zinc-200">
                Peer: <span className="font-mono text-cyan-200">{peerId}</span>
              </p>
              <p className="text-sm text-zinc-200">Turns: {Math.floor(messages.length / 2)}</p>
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-zinc-300">
                  Scope
                  <select
                    className="mt-1 w-full rounded border border-white/20 bg-black/30 p-1 text-xs"
                    value={scope}
                    onChange={(event) =>
                      setScope(event.target.value as "peer" | "channel-peer" | "global")
                    }
                  >
                    <option value="peer">peer</option>
                    <option value="channel-peer">channel-peer</option>
                    <option value="global">global</option>
                  </select>
                </label>
                <label className="block text-xs text-zinc-300">
                  Agent ID
                  <input
                    className="mt-1 w-full rounded border border-white/20 bg-black/30 p-1 text-xs"
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                  />
                </label>
                <button
                  className="rounded-md border border-white/20 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
                  onClick={startNewSession}
                >
                  New Session ID
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                est_in {usage.estimatedInputTokens} | in {usage.inputTokens} | out{" "}
                {usage.outputTokens}
              </p>
              {error ? <p className="mt-3 text-sm text-rose-300">Error: {error}</p> : null}
            </div>

            <div className="min-h-0 flex-1 rounded-2xl border border-white/15 bg-black/35 p-4 backdrop-blur">
              <h3 className="mb-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-100">
                Tool Activity
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
                {toolLog.length === 0 ? (
                  <p className="text-xs text-zinc-500">No tool calls yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-zinc-300">
                    {toolLog.slice(-20).map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-black/35 p-4 backdrop-blur">
              <h3 className="mb-2 font-mono text-sm uppercase tracking-[0.2em] text-lime-200">
                Registered Tools
              </h3>
              <ul className="space-y-2 text-sm text-zinc-200">
                {meta?.tools.map((tool) => (
                  <li key={tool.name} className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <p className="font-mono text-cyan-200">{tool.name}</p>
                    <p className="text-xs text-zinc-400">{tool.description}</p>
                  </li>
                )) ?? <li className="text-zinc-500">Loading tools...</li>}
              </ul>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

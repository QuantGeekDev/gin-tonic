import {
  buildSessionKey,
  compactSessionMessages,
  handleMessage,
  resolveAgentRoute,
} from "@jihn/agent-core";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useMemo, useState } from "react";
import type { AgentMessage, JihnAppProps, Mode, TokenUsage, TranscriptLine } from "./types.js";
import type { Message } from "@jihn/agent-core";

const MENU_ITEMS = [
  "Start Chat",
  "Run Diagnostics",
  "Show Tools",
  "Clear Conversation",
  "Quit",
] as const;

const SCROLL_STEP = 5;

function colorForLineKind(kind: TranscriptLine["kind"]): string {
  switch (kind) {
    case "user":
      return "cyan";
    case "assistant":
      return "green";
    case "tool":
      return "yellow";
    case "system":
      return "magenta";
    case "error":
      return "red";
    default:
      return "white";
  }
}

function prefixForLineKind(kind: TranscriptLine["kind"]): string {
  switch (kind) {
    case "user":
      return "You";
    case "assistant":
      return "Jihn";
    case "tool":
      return "Tool";
    case "system":
      return "System";
    case "error":
      return "Error";
    default:
      return "Log";
  }
}

function buildNextPeerId(currentPeerId: string): string {
  return `${currentPeerId.split("::")[0]}::${Date.now()}`;
}

export function JihnApp(props: JihnAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialPeerId = props.peerId ?? process.env.USER ?? "local-user";

  const [mode, setMode] = useState<Mode>("menu");
  const [menuIndex, setMenuIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [activePeerId, setActivePeerId] = useState(initialPeerId);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([
    {
      kind: "system",
      text: "Welcome to Jihn Agent UI. Select an option to begin.",
    },
  ]);
  const [usage, setUsage] = useState<TokenUsage>({
    estimatedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  const [status, setStatus] = useState("Ready");
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleTranscript = useMemo(() => {
    const maxLines = Math.max(8, (stdout.rows ?? 24) - 18);
    const boundedOffset = Math.min(scrollOffset, Math.max(0, transcript.length - 1));
    const end = transcript.length - boundedOffset;
    const start = Math.max(0, end - maxLines);
    return transcript.slice(start, end);
  }, [stdout.rows, transcript, scrollOffset]);

  const maxScrollOffset = Math.max(0, transcript.length - 1);
  const canScrollUp = scrollOffset < maxScrollOffset;
  const canScrollDown = scrollOffset > 0;

  const pushTranscript = (line: TranscriptLine): void => {
    setTranscript((prev) => [...prev, line]);
    setScrollOffset(0);
  };

  const runDiagnostics = async (): Promise<void> => {
    if (busy) {
      return;
    }

    setBusy(true);
    setStatus("Running diagnostics...");
    pushTranscript({ kind: "system", text: "Running quick diagnostics..." });

    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    try {
      const sampleMessages = [
        { role: "user" as const, content: "one ".repeat(80) },
        { role: "assistant" as const, content: "two ".repeat(80) },
        { role: "user" as const, content: "three ".repeat(80) },
        { role: "assistant" as const, content: "four ".repeat(80) },
        { role: "user" as const, content: "five ".repeat(80) },
        { role: "assistant" as const, content: "six ".repeat(80) },
        { role: "user" as const, content: "seven ".repeat(80) },
      ];
      const countTokens = async (
        messages: Message[],
      ): Promise<number> =>
        Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
      const a = await compactSessionMessages(
        sampleMessages,
        { tokenBudget: 350 },
        countTokens,
      );
      const b = await compactSessionMessages(
        sampleMessages,
        { tokenBudget: 350 },
        countTokens,
      );
      checks.push({
        name: "compaction_determinism",
        ok: JSON.stringify(a.messages) === JSON.stringify(b.messages),
        detail: `${a.beforeTokens} -> ${a.afterTokens} (${a.strategy})`,
      });

      const routed = resolveAgentRoute({
        text: "/agent:research draft a report",
        defaultAgentId: "main",
      });
      checks.push({
        name: "routing_directive",
        ok: routed.agentId === "research" && routed.text === "draft a report",
        detail: `agent=${routed.agentId} text="${routed.text}"`,
      });

      const sessionKey = buildSessionKey({
        agentId: "main",
        scope: "peer",
        peerId: "alex",
        channelId: "cli",
      });
      checks.push({
        name: "session_key_scope",
        ok: sessionKey === "agent:main:scope:peer:peer:alex:channel:cli",
        detail: sessionKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        name: "diagnostic_runtime",
        ok: false,
        detail: message,
      });
    }

    for (const check of checks) {
      pushTranscript({
        kind: check.ok ? "system" : "error",
        text: `${check.ok ? "PASS" : "FAIL"} ${check.name} :: ${check.detail}`,
      });
    }

    const passed = checks.filter((check) => check.ok).length;
    const failed = checks.length - passed;
    setStatus(failed === 0 ? "Diagnostics passed" : "Diagnostics found issues");
    pushTranscript({
      kind: failed === 0 ? "system" : "error",
      text: `Diagnostics summary: ${passed} passed, ${failed} failed`,
    });
    setBusy(false);
  };

  const resetConversation = (reason: string): void => {
    const nextPeerId = buildNextPeerId(activePeerId);
    setActivePeerId(nextPeerId);
    setMessages([]);
    setTurnCount(0);
    setUsage({
      estimatedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    setTranscript([
      {
        kind: "system",
        text: `Conversation cleared. New session: ${nextPeerId}`,
      },
    ]);
    setScrollOffset(0);
    setStatus(reason);
  };

  useInput((input, key) => {
    if (mode === "menu") {
      if (key.upArrow) {
        setMenuIndex((prev) => (prev === 0 ? MENU_ITEMS.length - 1 : prev - 1));
        return;
      }

      if (key.downArrow) {
        setMenuIndex((prev) => (prev === MENU_ITEMS.length - 1 ? 0 : prev + 1));
        return;
      }

      if (key.return) {
        const selected = MENU_ITEMS[menuIndex];
        if (selected === "Start Chat") {
          setMode("chat");
          setStatus("Chat mode");
        } else if (selected === "Run Diagnostics") {
          void runDiagnostics();
        } else if (selected === "Show Tools") {
          setMode("tools");
          setStatus("Viewing registered tools");
        } else if (selected === "Clear Conversation") {
          resetConversation("Conversation reset");
        } else if (selected === "Quit") {
          exit();
        }
      }

      return;
    }

    if (mode === "tools") {
      if (key.escape || key.return) {
        setMode("menu");
        setStatus("Returned to menu");
      }
      return;
    }

    if (mode === "chat") {
      if (key.pageUp) {
        setScrollOffset((prev) => Math.min(maxScrollOffset, prev + SCROLL_STEP));
        return;
      }

      if (key.pageDown) {
        setScrollOffset((prev) => Math.max(0, prev - SCROLL_STEP));
        return;
      }

      if (key.escape) {
        setMode("menu");
        setStatus("Returned to menu");
        return;
      }

      if (key.ctrl && input.toLowerCase() === "c") {
        exit();
      }
    }
  });

  const onSubmit = async (value: string): Promise<void> => {
    if (busy) {
      return;
    }

    const userText = value.trim();
    if (userText.length === 0) {
      return;
    }

    if (userText === "/menu") {
      setMode("menu");
      setStatus("Returned to menu");
      return;
    }

    if (userText === "/clear") {
      resetConversation("Conversation reset");
      return;
    }

    if (userText === "/tools") {
      setMode("tools");
      setStatus("Viewing registered tools");
      return;
    }

    if (userText === "/help") {
      pushTranscript({
        kind: "system",
        text: "Shortcuts: PgUp/PgDn scroll, Esc menu, /tools, /clear, /menu, /help, /diagnostics.",
      });
      setStatus("Displayed help");
      return;
    }

    if (userText === "/diagnostics") {
      void runDiagnostics();
      return;
    }

    setInputValue("");
    setBusy(true);
    setStatus("Running agent turn...");

    pushTranscript({ kind: "user", text: userText });

    try {
      const routed = resolveAgentRoute({
        text: userText,
        defaultAgentId: props.agentId ?? "main",
      });
      if (routed.text.trim().length === 0) {
        throw new Error("message text is empty after routing directive");
      }

      const result =
        props.runGatewayTurn !== undefined
          ? await props.runGatewayTurn({
              text: routed.text,
              agentId: routed.agentId,
              scope: props.scope,
              channelId: props.channelId ?? "cli",
              peerId: activePeerId,
            })
          : await (async () => {
              const systemPrompt = await props.resolveSystemPrompt(routed.agentId);
              return await handleMessage({
                client: props.client,
                model: props.model,
                tools: props.tools,
                text: routed.text,
                routing: {
                  agentId: routed.agentId,
                  ...(props.scope !== undefined ? { scope: props.scope } : {}),
                  channelId: props.channelId ?? "cli",
                  peerId: activePeerId,
                },
                ...(props.sessionStore !== undefined
                  ? { sessionStore: props.sessionStore }
                  : {}),
                ...(props.toolPolicy !== undefined ? { toolPolicy: props.toolPolicy } : {}),
                ...(props.sessionCompaction !== undefined
                  ? { sessionCompaction: props.sessionCompaction }
                  : {}),
                ...(props.idempotencyStore !== undefined
                  ? { idempotencyStore: props.idempotencyStore }
                  : {}),
                ...(props.lockManager !== undefined
                  ? { lockManager: props.lockManager }
                  : {}),
                ...(props.pluginRuntime !== undefined
                  ? { pluginRuntime: props.pluginRuntime }
                  : {}),
                systemPrompt,
                maxTurns: props.maxTurns,
                maxTokens: props.maxTokens,
                executeTool: async (name, input) => {
                  pushTranscript({ kind: "tool", text: `🔧 ${name}: ${JSON.stringify(input)}` });
                  const toolOutput = await props.executeTool(name, input);
                  pushTranscript({ kind: "tool", text: `→ ${toolOutput}` });
                  return toolOutput;
                },
              });
            })();

      setMessages(result.messages);
      setTurnCount((prev) => prev + 1);
      setUsage(result.usage);
      pushTranscript({ kind: "assistant", text: result.text });
      setStatus("Turn complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushTranscript({ kind: "error", text: message });
      setStatus("Turn failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyanBright">Jihn Agent</Text>
        <Text color="gray">  |  </Text>
        <Text color="magentaBright">Model: {props.model}</Text>
        <Text color="gray">  |  </Text>
        <Text color="blueBright">Turns: {turnCount}</Text>
        <Text color="gray">  |  </Text>
        <Text color={busy ? "yellow" : "green"}>{busy ? "Thinking..." : "Idle"}</Text>
      </Box>

      <Box marginTop={1} columnGap={1}>
        <Box width="70%" borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
          <Text color="blueBright">Scrollback</Text>
          {visibleTranscript.map((line, index) => (
            <Text key={`${line.kind}-${index}`} color={colorForLineKind(line.kind)}>
              {prefixForLineKind(line.kind)}: {line.text}
            </Text>
          ))}
          <Text color="gray">
            Scroll: {scrollOffset}/{maxScrollOffset} {canScrollUp ? "↑" : ""} {canScrollDown ? "↓" : ""}
          </Text>
        </Box>

        <Box width="30%" borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
          <Text color="greenBright">Operator</Text>
          <Text color="white">Mode: {mode}</Text>
          <Text color="white">Status: {status}</Text>
          <Text color="white">Peer: {activePeerId}</Text>
          <Text color="white">Tools: {props.tools.length}</Text>
          <Text color="white">Msgs: {messages.length}</Text>
          <Text color="gray">Use /help in chat</Text>
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="greenBright">
          Tokens est_in={usage.estimatedInputTokens} in={usage.inputTokens} out={usage.outputTokens}
        </Text>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
        {mode === "menu" && (
          <>
            <Text color="blueBright">Main Menu</Text>
            {MENU_ITEMS.map((item, index) => (
              <Text key={item} color={index === menuIndex ? "yellow" : "white"}>
                {index === menuIndex ? "❯ " : "  "}
                {item}
              </Text>
            ))}
            <Text color="gray">Use ↑ ↓ and Enter</Text>
          </>
        )}

        {mode === "tools" && (
          <>
            <Text color="blueBright">Registered Tools</Text>
            {props.tools.map((tool) => (
              <Box key={tool.name} flexDirection="column" marginBottom={1}>
                <Text color="yellow">{tool.name}</Text>
                <Text color="gray">{tool.description}</Text>
              </Box>
            ))}
            <Text color="gray">Press Esc or Enter to return</Text>
          </>
        )}
      </Box>

      {mode === "chat" && (
        <Box marginTop={1} borderStyle="single" borderColor="magenta" paddingX={1}>
          <Text color="magentaBright">Prompt</Text>
          <Text> </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={(value) => {
              void onSubmit(value);
            }}
          />
        </Box>
      )}

      <Box marginTop={1} borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text color="magentaBright">
          Shortcuts: Menu(↑/↓ Enter)  Chat(PgUp/PgDn scroll, Esc menu, Ctrl+C quit)  Commands(/help /tools /clear /menu)
        </Text>
      </Box>
    </Box>
  );
}

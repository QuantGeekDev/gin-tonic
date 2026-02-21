import type { Message } from "../types/message.js";
import type { ContentBlock } from "../types/message.js";

const DEFAULT_PRESERVE_RECENT_MESSAGES = 8;
const MIN_PRESERVE_RECENT_MESSAGES = 2;
const SUMMARY_CHAR_BUDGETS = [4000, 2400, 1400, 800, 400] as const;

export type CountContextTokens = (messages: Message[]) => Promise<number>;
export type SummarizeMessages = (params: {
  messages: Message[];
  maxChars: number;
}) => Promise<string>;

export interface SessionCompactionOptions {
  tokenBudget: number;
  targetTokenBudget?: number;
  preserveRecentMessages?: number;
  minMessagesToCompact?: number;
  summarizeMessages?: SummarizeMessages;
}

export type SessionCompactionStrategy = "none" | "summary" | "tail_trim";

export interface SessionCompactionResult {
  messages: Message[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  strategy: SessionCompactionStrategy;
  beforeMessageCount: number;
  afterMessageCount: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function blockToText(block: ContentBlock): string {
  if (block.type === "text") {
    return block.text;
  }
  if (block.type === "tool_use") {
    return `tool_use ${block.name} ${JSON.stringify(block.input)}`;
  }
  return `tool_result ${block.content}`;
}

function messageToText(message: Message): string {
  if (typeof message.content === "string") {
    return normalizeWhitespace(message.content);
  }
  const text = message.content.map(blockToText).join(" | ");
  return normalizeWhitespace(text);
}

function buildSummaryMessage(
  olderMessages: Message[],
  charBudget: number,
): Message {
  const lines: string[] = [];
  lines.push("Session compaction summary (deterministic):");
  lines.push(
    `- summarized_messages: ${olderMessages.length}`,
  );

  let remaining = Math.max(0, charBudget - lines.join("\n").length - 1);
  for (const message of olderMessages) {
    if (remaining <= 0) {
      break;
    }
    const rawText = messageToText(message);
    if (rawText.length === 0) {
      continue;
    }
    const entry = `- ${message.role}: ${clip(rawText, Math.min(180, remaining))}`;
    lines.push(entry);
    remaining -= entry.length + 1;
  }

  return {
    role: "assistant",
    content: lines.join("\n"),
  };
}

async function compactByTailTrimming(
  messages: Message[],
  tokenBudget: number,
  countTokens: CountContextTokens,
): Promise<Message[]> {
  const kept: Message[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    kept.unshift(message);
    const tokens = await countTokens(kept);
    if (tokens > tokenBudget) {
      kept.shift();
      break;
    }
  }
  return kept;
}

export async function compactSessionMessages(
  messages: Message[],
  options: SessionCompactionOptions,
  countTokens: CountContextTokens,
): Promise<SessionCompactionResult> {
  if (!Number.isInteger(options.tokenBudget) || options.tokenBudget <= 0) {
    throw new Error("tokenBudget must be a positive integer");
  }

  const beforeTokens = await countTokens(messages);
  if (beforeTokens <= options.tokenBudget) {
    return {
      messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      strategy: "none",
      beforeMessageCount: messages.length,
      afterMessageCount: messages.length,
    };
  }

  const targetTokenBudget = Math.max(
    1,
    Math.min(
      options.tokenBudget,
      options.targetTokenBudget ?? Math.floor(options.tokenBudget * 0.8),
    ),
  );
  const minMessagesToCompact = options.minMessagesToCompact ?? 6;
  const preserveRecent = Math.max(
    MIN_PRESERVE_RECENT_MESSAGES,
    options.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES,
  );

  if (messages.length < minMessagesToCompact) {
    const trimmed = await compactByTailTrimming(messages, options.tokenBudget, countTokens);
    const afterTokens = await countTokens(trimmed);
    return {
      messages: trimmed,
      compacted: true,
      beforeTokens,
      afterTokens,
      strategy: "tail_trim",
      beforeMessageCount: messages.length,
      afterMessageCount: trimmed.length,
    };
  }

  for (
    let keepRecentCount = Math.min(preserveRecent, messages.length - 1);
    keepRecentCount >= MIN_PRESERVE_RECENT_MESSAGES;
    keepRecentCount -= 1
  ) {
    const olderMessages = messages.slice(0, messages.length - keepRecentCount);
    const recentMessages = messages.slice(messages.length - keepRecentCount);
    for (const summaryCharBudget of SUMMARY_CHAR_BUDGETS) {
      const llmSummary =
        options.summarizeMessages !== undefined
          ? normalizeWhitespace(
              await options.summarizeMessages({
                messages: olderMessages,
                maxChars: summaryCharBudget,
              }),
            )
          : null;
      const summary =
        llmSummary !== null && llmSummary.length > 0
          ? {
              role: "assistant" as const,
              content: clip(llmSummary, summaryCharBudget),
            }
          : buildSummaryMessage(olderMessages, summaryCharBudget);
      const compacted = [summary, ...recentMessages];
      const compactedTokens = await countTokens(compacted);
      if (compactedTokens <= targetTokenBudget) {
        return {
          messages: compacted,
          compacted: true,
          beforeTokens,
          afterTokens: compactedTokens,
          strategy: "summary",
          beforeMessageCount: messages.length,
          afterMessageCount: compacted.length,
        };
      }
    }
  }

  const trimmed = await compactByTailTrimming(messages, options.tokenBudget, countTokens);
  const afterTokens = await countTokens(trimmed);
  return {
    messages: trimmed,
    compacted: true,
    beforeTokens,
    afterTokens,
    strategy: "tail_trim",
    beforeMessageCount: messages.length,
    afterMessageCount: trimmed.length,
  };
}

import { z } from "zod";
import type { SessionScope } from "@jihn/agent-core";

const SessionScopeSchema = z.enum(["channel-peer", "peer", "global"] as const);
const TransportModeSchema = z.enum(["polling", "webhook"] as const);
const EnvBooleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const TelegramChannelConfigSchema = z.object({
  telegramBotToken: z.string().trim().min(1, "JIHN_TELEGRAM_BOT_TOKEN is required"),
  agentId: z.string().trim().min(1).default("main"),
  sessionScope: SessionScopeSchema.default("channel-peer"),
  transportMode: TransportModeSchema.default("polling"),
  webhookPublicBaseUrl: z.string().trim().url().optional(),
  webhookPath: z.string().trim().min(1).default("/telegram/webhook"),
  webhookSecret: z.string().trim().min(1).optional(),
  webhookPort: z.coerce.number().int().positive().default(8787),
  webhookHost: z.string().trim().min(1).default("0.0.0.0"),
  maxTurns: z.coerce.number().int().positive().default(20),
  maxTokens: z.coerce.number().int().positive().default(1024),
  replyToIncomingByDefault: EnvBooleanSchema.default(true),
  outboundMaxAttempts: z.coerce.number().int().min(1).max(10).default(4),
  outboundBaseDelayMs: z.coerce.number().int().min(10).max(60_000).default(250),
  allowedChatIds: z.string().optional(),
  debugFilePath: z.string().trim().min(1).default(`${process.cwd()}/.jihn/telegram-debug.json`),
  debugMaxEvents: z.coerce.number().int().min(10).max(500).default(120),
});

export interface TelegramChannelConfig {
  telegramBotToken: string;
  agentId: string;
  sessionScope: SessionScope;
  transportMode: "polling" | "webhook";
  webhookPublicBaseUrl: string | null;
  webhookPath: string;
  webhookSecret: string | null;
  webhookPort: number;
  webhookHost: string;
  maxTurns: number;
  maxTokens: number;
  replyToIncomingByDefault: boolean;
  outboundMaxAttempts: number;
  outboundBaseDelayMs: number;
  allowedChatIds: Set<number> | null;
  debugFilePath: string;
  debugMaxEvents: number;
}

function parseAllowedChatIds(raw: string | undefined): Set<number> | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const parsed = raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((value) => Number.isFinite(value));
  return new Set(parsed);
}

export function loadTelegramChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramChannelConfig {
  const token = env.JIHN_TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("JIHN_TELEGRAM_BOT_TOKEN is required");
  }

  const parsed = TelegramChannelConfigSchema.parse({
    telegramBotToken: token,
    agentId: env.JIHN_TELEGRAM_AGENT_ID,
    sessionScope: env.JIHN_TELEGRAM_SCOPE,
    transportMode: env.JIHN_TELEGRAM_TRANSPORT,
    webhookPublicBaseUrl: env.JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL,
    webhookPath: env.JIHN_TELEGRAM_WEBHOOK_PATH,
    webhookSecret: env.JIHN_TELEGRAM_WEBHOOK_SECRET,
    webhookPort: env.JIHN_TELEGRAM_WEBHOOK_PORT,
    webhookHost: env.JIHN_TELEGRAM_WEBHOOK_HOST,
    maxTurns: env.JIHN_TELEGRAM_MAX_TURNS,
    maxTokens: env.JIHN_TELEGRAM_MAX_TOKENS,
    replyToIncomingByDefault: env.JIHN_TELEGRAM_REPLY_TO_INCOMING,
    outboundMaxAttempts: env.JIHN_TELEGRAM_OUTBOUND_MAX_ATTEMPTS,
    outboundBaseDelayMs: env.JIHN_TELEGRAM_OUTBOUND_BASE_DELAY_MS,
    allowedChatIds: env.JIHN_TELEGRAM_ALLOWED_CHAT_IDS,
    debugFilePath: env.JIHN_TELEGRAM_DEBUG_FILE,
    debugMaxEvents: env.JIHN_TELEGRAM_DEBUG_MAX_EVENTS,
  });

  if (parsed.transportMode === "webhook" && !parsed.webhookPublicBaseUrl) {
    throw new Error(
      "JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL is required when JIHN_TELEGRAM_TRANSPORT=webhook",
    );
  }

  return {
    telegramBotToken: parsed.telegramBotToken,
    agentId: parsed.agentId,
    sessionScope: parsed.sessionScope,
    transportMode: parsed.transportMode,
    webhookPublicBaseUrl: parsed.webhookPublicBaseUrl ?? null,
    webhookPath: parsed.webhookPath.startsWith("/") ? parsed.webhookPath : `/${parsed.webhookPath}`,
    webhookSecret: parsed.webhookSecret ?? null,
    webhookPort: parsed.webhookPort,
    webhookHost: parsed.webhookHost,
    maxTurns: parsed.maxTurns,
    maxTokens: parsed.maxTokens,
    replyToIncomingByDefault: parsed.replyToIncomingByDefault,
    outboundMaxAttempts: parsed.outboundMaxAttempts,
    outboundBaseDelayMs: parsed.outboundBaseDelayMs,
    allowedChatIds: parseAllowedChatIds(parsed.allowedChatIds),
    debugFilePath: parsed.debugFilePath,
    debugMaxEvents: parsed.debugMaxEvents,
  };
}

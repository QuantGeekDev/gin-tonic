import { z } from "zod";
import type { ChannelAuthMode, SessionScope } from "@jihn/agent-core";

const SessionScopeSchema = z.enum(["channel-peer", "peer", "global"] as const);
const TransportModeSchema = z.enum(["polling", "webhook"] as const);
const ChannelAuthModeSchema = z.enum(["off", "open", "pairing"] as const);
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
const MetricsPathSchema = z.string().trim().min(1).default("/metrics");

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
  typingIndicatorEnabled: EnvBooleanSchema.default(true),
  typingIntervalMs: z.coerce.number().int().min(1_000).max(10_000).default(4_000),
  outboundMaxAttempts: z.coerce.number().int().min(1).max(10).default(4),
  outboundBaseDelayMs: z.coerce.number().int().min(10).max(60_000).default(250),
  outboundBackend: z.enum(["memory", "postgres"] as const).default("memory"),
  allowedChatIds: z.string().optional(),
  debugFilePath: z.string().trim().min(1).default(`${process.cwd()}/.jihn/telegram-debug.json`),
  debugMaxEvents: z.coerce.number().int().min(10).max(500).default(120),
  metricsEnabled: EnvBooleanSchema.default(false),
  metricsHost: z.string().trim().min(1).default("127.0.0.1"),
  metricsPort: z.coerce.number().int().positive().default(18792),
  metricsPath: MetricsPathSchema,
  authMode: ChannelAuthModeSchema.default("off"),
  authStoreFilePath: z
    .string()
    .trim()
    .min(1)
    .default(`${process.cwd()}/.jihn/channel-auth.json`),
  authHashSecret: z.string().trim().min(1).optional(),
  authCodeLength: z.coerce.number().int().min(4).max(10).default(6),
  authCodeTtlMs: z.coerce.number().int().min(30_000).max(30 * 60_000).default(5 * 60_000),
  authMaxAttempts: z.coerce.number().int().min(1).max(10).default(5),
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
  typingIndicatorEnabled: boolean;
  typingIntervalMs: number;
  outboundMaxAttempts: number;
  outboundBaseDelayMs: number;
  outboundBackend: "memory" | "postgres";
  allowedChatIds: Set<number> | null;
  debugFilePath: string;
  debugMaxEvents: number;
  metricsEnabled: boolean;
  metricsHost: string;
  metricsPort: number;
  metricsPath: string;
  authMode: ChannelAuthMode;
  authStoreFilePath: string;
  authHashSecret: string | null;
  authCodeLength: number;
  authCodeTtlMs: number;
  authMaxAttempts: number;
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
    typingIndicatorEnabled: env.JIHN_TELEGRAM_TYPING_ENABLED,
    typingIntervalMs: env.JIHN_TELEGRAM_TYPING_INTERVAL_MS,
    outboundMaxAttempts: env.JIHN_TELEGRAM_OUTBOUND_MAX_ATTEMPTS,
    outboundBaseDelayMs: env.JIHN_TELEGRAM_OUTBOUND_BASE_DELAY_MS,
    outboundBackend: env.JIHN_TELEGRAM_OUTBOX_BACKEND,
    allowedChatIds: env.JIHN_TELEGRAM_ALLOWED_CHAT_IDS,
    debugFilePath: env.JIHN_TELEGRAM_DEBUG_FILE,
    debugMaxEvents: env.JIHN_TELEGRAM_DEBUG_MAX_EVENTS,
    metricsEnabled: env.JIHN_TELEGRAM_METRICS_ENABLED,
    metricsHost: env.JIHN_TELEGRAM_METRICS_HOST,
    metricsPort: env.JIHN_TELEGRAM_METRICS_PORT,
    metricsPath: env.JIHN_TELEGRAM_METRICS_PATH,
    authMode: env.JIHN_CHANNEL_AUTH_MODE,
    authStoreFilePath: env.JIHN_CHANNEL_AUTH_STORE_FILE,
    authHashSecret: env.JIHN_CHANNEL_AUTH_SECRET,
    authCodeLength: env.JIHN_CHANNEL_AUTH_CODE_LENGTH,
    authCodeTtlMs: env.JIHN_CHANNEL_AUTH_CODE_TTL_MS,
    authMaxAttempts: env.JIHN_CHANNEL_AUTH_MAX_ATTEMPTS,
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
    typingIndicatorEnabled: parsed.typingIndicatorEnabled,
    typingIntervalMs: parsed.typingIntervalMs,
    outboundMaxAttempts: parsed.outboundMaxAttempts,
    outboundBaseDelayMs: parsed.outboundBaseDelayMs,
    outboundBackend: parsed.outboundBackend,
    allowedChatIds: parseAllowedChatIds(parsed.allowedChatIds),
    debugFilePath: parsed.debugFilePath,
    debugMaxEvents: parsed.debugMaxEvents,
    metricsEnabled: parsed.metricsEnabled,
    metricsHost: parsed.metricsHost,
    metricsPort: parsed.metricsPort,
    metricsPath: parsed.metricsPath.startsWith("/") ? parsed.metricsPath : `/${parsed.metricsPath}`,
    authMode: parsed.authMode,
    authStoreFilePath: parsed.authStoreFilePath,
    authHashSecret: parsed.authHashSecret ?? null,
    authCodeLength: parsed.authCodeLength,
    authCodeTtlMs: parsed.authCodeTtlMs,
    authMaxAttempts: parsed.authMaxAttempts,
  };
}

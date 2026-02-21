import { resolveTtsConfigFromEnv, type TtsProviderId } from "../tts/elevenlabs.js";

export type ChannelTtsMode = "off" | "text_and_voice" | "voice_only";

export interface ChannelTtsPolicy {
  channelId: string;
  provider: TtsProviderId;
  mode: ChannelTtsMode;
  maxChars: number;
  outputFormat: string;
  voiceId?: string;
  modelId?: string;
  disabledReason?: string;
}

const DEFAULT_MODE: ChannelTtsMode = "off";
const DEFAULT_MAX_CHARS = 1_200;
const MIN_MAX_CHARS = 100;
const MAX_MAX_CHARS = 6_000;

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeChannelEnvPrefix(channelId: string): string {
  const normalized = channelId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length === 0 ? "CHANNEL" : normalized;
}

function parseMode(raw: string | undefined): ChannelTtsMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  if (normalized === "off" || normalized === "text_and_voice" || normalized === "voice_only") {
    return normalized;
  }
  throw new Error(
    `Unsupported TTS mode '${raw}'. Allowed: off, text_and_voice, voice_only`,
  );
}

function parseMaxChars(raw: string | undefined): number | undefined {
  const normalized = normalizeNonEmpty(raw);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid TTS max chars '${raw}'. Must be an integer.`);
  }
  if (parsed < MIN_MAX_CHARS || parsed > MAX_MAX_CHARS) {
    throw new Error(
      `Invalid TTS max chars '${raw}'. Allowed range: ${MIN_MAX_CHARS}-${MAX_MAX_CHARS}.`,
    );
  }
  return parsed;
}

export function resolveChannelTtsPolicyFromEnv(params: {
  channelId: string;
  env?: Record<string, string | undefined>;
}): ChannelTtsPolicy {
  const env = params.env ?? process.env;
  const channelId = params.channelId.trim().toLowerCase();
  if (channelId.length === 0) {
    throw new Error("channelId is required for TTS policy resolution.");
  }

  const prefix = `JIHN_${normalizeChannelEnvPrefix(channelId)}_TTS_`;
  const providerConfig = resolveTtsConfigFromEnv(env);
  const channelMode = parseMode(env[`${prefix}MODE`]);
  const globalMode = parseMode(env.JIHN_TTS_MODE);
  const desiredMode = channelMode ?? globalMode ?? DEFAULT_MODE;
  const maxChars =
    parseMaxChars(env[`${prefix}MAX_CHARS`]) ??
    parseMaxChars(env.JIHN_TTS_MAX_CHARS) ??
    DEFAULT_MAX_CHARS;

  const voiceId = normalizeNonEmpty(env[`${prefix}VOICE_ID`]) ?? providerConfig.voiceId;
  const modelId = normalizeNonEmpty(env[`${prefix}MODEL_ID`]) ?? providerConfig.modelId;
  const outputFormat =
    normalizeNonEmpty(env[`${prefix}OUTPUT_FORMAT`]) ?? providerConfig.outputFormat;

  if (providerConfig.provider === "none") {
    return {
      channelId,
      provider: "none",
      mode: "off",
      maxChars,
      outputFormat,
      disabledReason: "JIHN_TTS_PROVIDER is disabled.",
    };
  }

  if (desiredMode !== "off" && voiceId === undefined) {
    return {
      channelId,
      provider: providerConfig.provider,
      mode: "off",
      maxChars,
      outputFormat,
      ...(modelId !== undefined ? { modelId } : {}),
      disabledReason: "No voice configured. Set JIHN_TTS_VOICE_ID or channel-specific override.",
    };
  }

  return {
    channelId,
    provider: providerConfig.provider,
    mode: desiredMode,
    maxChars,
    outputFormat,
    ...(voiceId !== undefined ? { voiceId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
  };
}


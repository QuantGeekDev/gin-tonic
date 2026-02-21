import { describe, expect, it } from "@jest/globals";

import { loadTelegramChannelConfig } from "../dist/config.js";

describe("loadTelegramChannelConfig", () => {
  it("parses required/optional env values", () => {
    const config = loadTelegramChannelConfig({
      JIHN_TELEGRAM_BOT_TOKEN: "token",
      JIHN_TELEGRAM_AGENT_ID: "research",
      JIHN_TELEGRAM_SCOPE: "peer",
      JIHN_TELEGRAM_MAX_TURNS: "12",
      JIHN_TELEGRAM_MAX_TOKENS: "800",
      JIHN_TELEGRAM_REPLY_TO_INCOMING: "false",
      JIHN_TELEGRAM_ALLOWED_CHAT_IDS: "123,-456",
      JIHN_TTS_PROVIDER: "none",
    });

    expect(config.agentId).toBe("research");
    expect(config.sessionScope).toBe("peer");
    expect(config.maxTurns).toBe(12);
    expect(config.maxTokens).toBe(800);
    expect(config.replyToIncomingByDefault).toBe(false);
    expect(config.typingIndicatorEnabled).toBe(true);
    expect(config.typingIntervalMs).toBe(4000);
    expect(config.ttsPolicy.mode).toBe("off");
    expect(config.ttsPolicy.outputFormat).toBe("mp3_44100_128");
    expect(config.ttsPolicy.maxChars).toBe(1200);
    expect(config.allowedChatIds?.has(123)).toBe(true);
    expect(config.allowedChatIds?.has(-456)).toBe(true);
  });

  it("throws when token missing", () => {
    expect(() => loadTelegramChannelConfig({})).toThrow("JIHN_TELEGRAM_BOT_TOKEN");
  });

  it("requires webhook base url in webhook mode", () => {
    expect(() =>
      loadTelegramChannelConfig({
        JIHN_TELEGRAM_BOT_TOKEN: "token",
        JIHN_TELEGRAM_TRANSPORT: "webhook",
      }),
    ).toThrow("JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL");
  });

  it("parses webhook and outbound settings", () => {
    const config = loadTelegramChannelConfig({
      JIHN_TELEGRAM_BOT_TOKEN: "token",
      JIHN_TELEGRAM_TRANSPORT: "webhook",
      JIHN_TELEGRAM_WEBHOOK_PUBLIC_BASE_URL: "https://bot.example.com",
      JIHN_TELEGRAM_WEBHOOK_PATH: "hooks/telegram",
      JIHN_TELEGRAM_WEBHOOK_SECRET: "secret",
      JIHN_TELEGRAM_WEBHOOK_PORT: "8899",
      JIHN_TELEGRAM_WEBHOOK_HOST: "127.0.0.1",
      JIHN_TELEGRAM_TYPING_ENABLED: "false",
      JIHN_TELEGRAM_TYPING_INTERVAL_MS: "1500",
      JIHN_TELEGRAM_TTS_MODE: "voice_only",
      JIHN_TELEGRAM_TTS_VOICE_ID: "voice-abc",
      JIHN_TELEGRAM_TTS_MODEL_ID: "eleven_multilingual_v2",
      JIHN_TELEGRAM_TTS_OUTPUT_FORMAT: "opus_48000_64",
      JIHN_TELEGRAM_TTS_MAX_CHARS: "1200",
      JIHN_TTS_PROVIDER: "elevenlabs",
      ELEVENLABS_API_KEY: "key",
      JIHN_TELEGRAM_OUTBOUND_MAX_ATTEMPTS: "5",
      JIHN_TELEGRAM_OUTBOUND_BASE_DELAY_MS: "400",
      JIHN_TELEGRAM_METRICS_ENABLED: "true",
      JIHN_TELEGRAM_METRICS_HOST: "0.0.0.0",
      JIHN_TELEGRAM_METRICS_PORT: "18888",
      JIHN_TELEGRAM_METRICS_PATH: "/internal/metrics",
    });

    expect(config.transportMode).toBe("webhook");
    expect(config.webhookPublicBaseUrl).toBe("https://bot.example.com");
    expect(config.webhookPath).toBe("/hooks/telegram");
    expect(config.webhookSecret).toBe("secret");
    expect(config.webhookPort).toBe(8899);
    expect(config.webhookHost).toBe("127.0.0.1");
    expect(config.typingIndicatorEnabled).toBe(false);
    expect(config.typingIntervalMs).toBe(1500);
    expect(config.ttsPolicy.mode).toBe("voice_only");
    expect(config.ttsPolicy.voiceId).toBe("voice-abc");
    expect(config.ttsPolicy.modelId).toBe("eleven_multilingual_v2");
    expect(config.ttsPolicy.outputFormat).toBe("opus_48000_64");
    expect(config.ttsPolicy.maxChars).toBe(1200);
    expect(config.outboundMaxAttempts).toBe(5);
    expect(config.outboundBaseDelayMs).toBe(400);
    expect(config.metricsEnabled).toBe(true);
    expect(config.metricsHost).toBe("0.0.0.0");
    expect(config.metricsPort).toBe(18888);
    expect(config.metricsPath).toBe("/internal/metrics");
  });
});

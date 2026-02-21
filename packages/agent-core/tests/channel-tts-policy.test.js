import { describe, expect, it } from "@jest/globals";

import { resolveChannelTtsPolicyFromEnv } from "../dist/index.js";

describe("channel tts policy", () => {
  it("disables when provider is off", () => {
    const policy = resolveChannelTtsPolicyFromEnv({
      channelId: "telegram",
      env: {
        JIHN_TTS_PROVIDER: "none",
        JIHN_TELEGRAM_TTS_MODE: "voice_only",
      },
    });
    expect(policy.mode).toBe("off");
    expect(policy.disabledReason).toContain("disabled");
  });

  it("uses global defaults with explicit mode", () => {
    const policy = resolveChannelTtsPolicyFromEnv({
      channelId: "web",
      env: {
        JIHN_TTS_PROVIDER: "elevenlabs",
        ELEVENLABS_API_KEY: "key",
        JIHN_TTS_MODE: "text_and_voice",
        JIHN_TTS_VOICE_ID: "global-voice",
      },
    });
    expect(policy.mode).toBe("text_and_voice");
    expect(policy.voiceId).toBe("global-voice");
    expect(policy.maxChars).toBe(1200);
    expect(policy.outputFormat).toBe("mp3_44100_128");
  });

  it("applies channel overrides over global settings", () => {
    const policy = resolveChannelTtsPolicyFromEnv({
      channelId: "telegram",
      env: {
        JIHN_TTS_PROVIDER: "elevenlabs",
        ELEVENLABS_API_KEY: "key",
        JIHN_TTS_MODE: "text_and_voice",
        JIHN_TTS_VOICE_ID: "global-voice",
        JIHN_TELEGRAM_TTS_MODE: "voice_only",
        JIHN_TELEGRAM_TTS_VOICE_ID: "telegram-voice",
        JIHN_TELEGRAM_TTS_OUTPUT_FORMAT: "opus_48000_64",
        JIHN_TELEGRAM_TTS_MAX_CHARS: "900",
      },
    });
    expect(policy.mode).toBe("voice_only");
    expect(policy.voiceId).toBe("telegram-voice");
    expect(policy.outputFormat).toBe("opus_48000_64");
    expect(policy.maxChars).toBe(900);
  });

  it("turns mode off when voice is missing", () => {
    const policy = resolveChannelTtsPolicyFromEnv({
      channelId: "telegram",
      env: {
        JIHN_TTS_PROVIDER: "elevenlabs",
        ELEVENLABS_API_KEY: "key",
        JIHN_TELEGRAM_TTS_MODE: "voice_only",
      },
    });
    expect(policy.mode).toBe("off");
    expect(policy.disabledReason).toContain("voice");
  });
});

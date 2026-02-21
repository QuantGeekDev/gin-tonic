import { describe, expect, it, jest } from "@jest/globals";

import {
  createElevenLabsTtsProvider,
  createTtsProviderFromEnv,
  resolveTtsConfigFromEnv,
} from "../dist/index.js";

function createStreamFromBytes(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe("tts elevenlabs", () => {
  it("resolves provider and defaults from env", () => {
    const config = resolveTtsConfigFromEnv({
      JIHN_TTS_PROVIDER: "elevenlabs",
      ELEVENLABS_API_KEY: "test-key",
    });
    expect(config.provider).toBe("elevenlabs");
    expect(config.apiKey).toBe("test-key");
    expect(config.modelId).toBe("eleven_multilingual_v2");
    expect(config.outputFormat).toBe("mp3_44100_128");
  });

  it("returns null provider when disabled", () => {
    const provider = createTtsProviderFromEnv({
      JIHN_TTS_PROVIDER: "none",
    });
    expect(provider).toBeNull();
  });

  it("synthesizes bytes via elevenlabs client", async () => {
    const mockConvert = jest.fn(async () => createStreamFromBytes([1, 2, 3, 4]));
    const provider = createElevenLabsTtsProvider({
      defaultVoiceId: "voice_123",
      defaultModelId: "eleven_multilingual_v2",
      defaultOutputFormat: "opus_48000_64",
      client: {
        textToSpeech: {
          convert: mockConvert,
        },
      },
    });

    const result = await provider.synthesize({ text: "hello world" });
    expect(mockConvert).toHaveBeenCalledWith(
      "voice_123",
      expect.objectContaining({
        text: "hello world",
        modelId: "eleven_multilingual_v2",
        outputFormat: "opus_48000_64",
      }),
    );
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4]);
    expect(result.contentType).toBe("audio/ogg");
    expect(result.outputFormat).toBe("opus_48000_64");
  });

  it("requires voice id when missing", async () => {
    const provider = createElevenLabsTtsProvider({
      client: {
        textToSpeech: {
          convert: async () => createStreamFromBytes([1]),
        },
      },
    });
    await expect(provider.synthesize({ text: "hi" })).rejects.toThrow("JIHN_TTS_VOICE_ID");
  });
});

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export type TtsProviderId = "none" | "elevenlabs";

export interface TtsSynthesisInput {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

export interface TtsSynthesisResult {
  audio: Uint8Array;
  contentType: string;
  outputFormat: string;
}

export interface TtsProvider {
  readonly providerId: TtsProviderId;
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>;
}

export interface ElevenLabsTtsOptions {
  apiKey?: string;
  defaultVoiceId?: string;
  defaultModelId?: string;
  defaultOutputFormat?: string;
  client?: Pick<ElevenLabsClient, "textToSpeech">;
}

export interface ResolvedTtsConfig {
  provider: TtsProviderId;
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  outputFormat: string;
}

const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

function outputFormatToContentType(format: string): string {
  if (format.startsWith("mp3_")) {
    return "audio/mpeg";
  }
  if (format.startsWith("pcm_")) {
    return "audio/pcm";
  }
  if (format.startsWith("ulaw_") || format.startsWith("mulaw_")) {
    return "audio/basic";
  }
  if (format.startsWith("alaw_")) {
    return "audio/G711-ALAW";
  }
  if (format.startsWith("opus_")) {
    return "audio/ogg";
  }
  if (format.startsWith("wav_")) {
    return "audio/wav";
  }
  return "application/octet-stream";
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveTtsConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedTtsConfig {
  const providerRaw = env.JIHN_TTS_PROVIDER?.trim().toLowerCase();
  const provider: TtsProviderId =
    providerRaw === "none" || providerRaw === undefined || providerRaw.length === 0
      ? "none"
      : providerRaw === "elevenlabs"
        ? "elevenlabs"
        : (() => {
            throw new Error(
              `Unsupported JIHN_TTS_PROVIDER '${env.JIHN_TTS_PROVIDER}'. Allowed: none, elevenlabs`,
            );
          })();

  const outputFormat = normalizeNonEmpty(env.JIHN_TTS_OUTPUT_FORMAT) ?? DEFAULT_OUTPUT_FORMAT;
  const modelId = normalizeNonEmpty(env.JIHN_TTS_MODEL_ID) ?? DEFAULT_MODEL_ID;
  const voiceId = normalizeNonEmpty(env.JIHN_TTS_VOICE_ID);
  const apiKey = normalizeNonEmpty(env.ELEVENLABS_API_KEY);

  return {
    provider,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(voiceId !== undefined ? { voiceId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    outputFormat,
  };
}

export function createElevenLabsTtsProvider(options: ElevenLabsTtsOptions = {}): TtsProvider {
  const apiKey = normalizeNonEmpty(options.apiKey);
  if (apiKey === undefined && options.client === undefined) {
    throw new Error("ELEVENLABS_API_KEY is required when JIHN_TTS_PROVIDER=elevenlabs.");
  }

  const client =
    options.client ??
    new ElevenLabsClient(apiKey !== undefined ? { apiKey } : {});
  const defaultVoiceId = normalizeNonEmpty(options.defaultVoiceId);
  const defaultModelId = normalizeNonEmpty(options.defaultModelId) ?? DEFAULT_MODEL_ID;
  const defaultOutputFormat = normalizeNonEmpty(options.defaultOutputFormat) ?? DEFAULT_OUTPUT_FORMAT;

  return {
    providerId: "elevenlabs",
    async synthesize(input) {
      const text = input.text.trim();
      if (text.length === 0) {
        throw new Error("TTS input text must be non-empty.");
      }
      const voiceId = normalizeNonEmpty(input.voiceId) ?? defaultVoiceId;
      if (voiceId === undefined) {
        throw new Error("JIHN_TTS_VOICE_ID is required for ElevenLabs TTS.");
      }
      const modelId = normalizeNonEmpty(input.modelId) ?? defaultModelId;
      const outputFormat = normalizeNonEmpty(input.outputFormat) ?? defaultOutputFormat;

      const stream = await client.textToSpeech.convert(voiceId, {
        text,
        modelId,
        outputFormat: outputFormat as never,
      });

      const buffer = new Uint8Array(await new Response(stream).arrayBuffer());
      return {
        audio: buffer,
        contentType: outputFormatToContentType(outputFormat),
        outputFormat,
      };
    },
  };
}

export function createTtsProviderFromEnv(
  env: Record<string, string | undefined>,
): TtsProvider | null {
  const config = resolveTtsConfigFromEnv(env);
  if (config.provider === "none") {
    return null;
  }
  return createElevenLabsTtsProvider({
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.voiceId !== undefined ? { defaultVoiceId: config.voiceId } : {}),
    ...(config.modelId !== undefined ? { defaultModelId: config.modelId } : {}),
    defaultOutputFormat: config.outputFormat,
  });
}

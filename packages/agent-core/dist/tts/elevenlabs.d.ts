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
export declare function resolveTtsConfigFromEnv(env: Record<string, string | undefined>): ResolvedTtsConfig;
export declare function createElevenLabsTtsProvider(options?: ElevenLabsTtsOptions): TtsProvider;
export declare function createTtsProviderFromEnv(env: Record<string, string | undefined>): TtsProvider | null;
//# sourceMappingURL=elevenlabs.d.ts.map
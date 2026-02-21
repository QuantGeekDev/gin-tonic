import { type TtsProviderId } from "../tts/elevenlabs.js";
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
export declare function resolveChannelTtsPolicyFromEnv(params: {
    channelId: string;
    env?: Record<string, string | undefined>;
}): ChannelTtsPolicy;
//# sourceMappingURL=tts-policy.d.ts.map
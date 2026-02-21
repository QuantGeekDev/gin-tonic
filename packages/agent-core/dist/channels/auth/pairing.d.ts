import { z } from "zod";
export declare const CHANNEL_AUTH_MODES: readonly ["off", "open", "pairing"];
export type ChannelAuthMode = (typeof CHANNEL_AUTH_MODES)[number];
declare const ChallengeSchema: z.ZodObject<{
    channelId: z.ZodString;
    senderId: z.ZodString;
    codeHash: z.ZodString;
    issuedAtMs: z.ZodNumber;
    expiresAtMs: z.ZodNumber;
    attempts: z.ZodNumber;
    maxAttempts: z.ZodNumber;
}, z.core.$strip>;
type ChallengeRecord = z.infer<typeof ChallengeSchema>;
export interface ChannelPairingStore {
    isAuthorized(channelId: string, senderId: string): Promise<boolean>;
    authorize(channelId: string, senderId: string): Promise<void>;
    getChallenge(channelId: string, senderId: string): Promise<ChallengeRecord | null>;
    saveChallenge(record: ChallengeRecord): Promise<void>;
    clearChallenge(channelId: string, senderId: string): Promise<void>;
}
export declare class FileChannelPairingStore implements ChannelPairingStore {
    private readonly filePath;
    private writeChain;
    constructor(filePath: string);
    isAuthorized(channelId: string, senderId: string): Promise<boolean>;
    authorize(channelId: string, senderId: string): Promise<void>;
    getChallenge(channelId: string, senderId: string): Promise<ChallengeRecord | null>;
    saveChallenge(record: ChallengeRecord): Promise<void>;
    clearChallenge(channelId: string, senderId: string): Promise<void>;
    private loadState;
    private updateState;
}
export interface ChannelAuthPairingMiddlewareOptions {
    mode: ChannelAuthMode;
    store: ChannelPairingStore;
    hashSecret: string;
    codeLength?: number;
    codeTtlMs?: number;
    maxAttempts?: number;
    now?: () => number;
}
export type ChannelAuthDecision = {
    decision: "allow";
} | {
    decision: "deny";
    responseText: string;
    reason: string;
};
export interface ChannelAuthInboundInput {
    channelId: string;
    senderId: string;
    text: string;
}
export declare class ChannelAuthPairingMiddleware {
    private readonly mode;
    private readonly store;
    private readonly hashSecret;
    private readonly codeLength;
    private readonly codeTtlMs;
    private readonly maxAttempts;
    private readonly now;
    constructor(options: ChannelAuthPairingMiddlewareOptions);
    evaluate(input: ChannelAuthInboundInput): Promise<ChannelAuthDecision>;
    private issueChallenge;
    private verifyChallenge;
}
export {};
//# sourceMappingURL=pairing.d.ts.map
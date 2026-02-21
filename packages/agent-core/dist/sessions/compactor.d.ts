import type { Message } from "../types/message.js";
export type CountContextTokens = (messages: Message[]) => Promise<number>;
export type SummarizeMessages = (params: {
    messages: Message[];
    maxChars: number;
}) => Promise<string>;
export interface SessionCompactionOptions {
    tokenBudget: number;
    targetTokenBudget?: number;
    preserveRecentMessages?: number;
    minMessagesToCompact?: number;
    summarizeMessages?: SummarizeMessages;
}
export type SessionCompactionStrategy = "none" | "summary" | "tail_trim";
export interface SessionCompactionResult {
    messages: Message[];
    compacted: boolean;
    beforeTokens: number;
    afterTokens: number;
    strategy: SessionCompactionStrategy;
    beforeMessageCount: number;
    afterMessageCount: number;
}
export declare function compactSessionMessages(messages: Message[], options: SessionCompactionOptions, countTokens: CountContextTokens): Promise<SessionCompactionResult>;
//# sourceMappingURL=compactor.d.ts.map
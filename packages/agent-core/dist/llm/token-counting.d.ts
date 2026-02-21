import type { Message } from "../types/message.js";
import type { LlmCountTokensParams, LlmProviderClient } from "./types.js";
export declare function estimateMessageTokens(messages: Message[]): number;
export declare function countContextTokens(client: LlmProviderClient, params: LlmCountTokensParams): Promise<number>;
//# sourceMappingURL=token-counting.d.ts.map
import type { Message } from "../types/message.js";
import type { LlmCountTokensParams, LlmProviderClient } from "./types.js";

export function estimateMessageTokens(messages: Message[]): number {
  const roughChars = messages.reduce((total, message) => {
    return total + JSON.stringify(message).length;
  }, 0);
  return Math.max(1, Math.ceil(roughChars / 4));
}

export async function countContextTokens(
  client: LlmProviderClient,
  params: LlmCountTokensParams,
): Promise<number> {
  if (typeof client.countTokens !== "function") {
    return estimateMessageTokens(params.messages);
  }
  return client.countTokens(params);
}

import { describe, expect, it } from "@jest/globals";

import {
  countContextTokens,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER_ID,
  estimateMessageTokens,
  listRegisteredProviderIds,
  resolveLlmConfigFromEnv,
  resolveLlmProviderId,
} from "../dist/index.js";

describe("llm provider registry", () => {
  it("resolves default provider and model", () => {
    expect(resolveLlmProviderId(undefined)).toBe(DEFAULT_LLM_PROVIDER_ID);
    const resolved = resolveLlmConfigFromEnv({});
    expect(resolved.providerId).toBe(DEFAULT_LLM_PROVIDER_ID);
    expect(resolved.model).toBe(DEFAULT_LLM_MODEL);
  });

  it("rejects unsupported provider IDs", () => {
    expect(() => resolveLlmProviderId("unsupported-provider")).toThrow(
      "Unsupported JIHN_LLM_PROVIDER",
    );
  });

  it("registers anthropic and openai providers", () => {
    expect(listRegisteredProviderIds()).toEqual(["anthropic", "openai"]);
  });

  it("resolves OpenAI provider-specific model environment", () => {
    const resolved = resolveLlmConfigFromEnv({
      JIHN_LLM_PROVIDER: "openai",
      OPENAI_MODEL: "gpt-4o-mini",
    });
    expect(resolved).toEqual({
      providerId: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("falls back to heuristic token estimate when provider countTokens is missing", async () => {
    const tokens = await countContextTokens(
      {
        providerId: "test-provider",
        async createTurn() {
          return {
            stopReason: "end_turn",
            content: "unused",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      },
      {
        model: "test-model",
        systemPrompt: "prompt",
        tools: [],
        messages: [{ role: "user", content: "hello world" }],
      },
    );

    expect(tokens).toBe(estimateMessageTokens([{ role: "user", content: "hello world" }]));
  });
});

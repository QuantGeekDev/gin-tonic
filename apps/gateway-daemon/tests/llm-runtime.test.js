import { describe, expect, it } from "@jest/globals";

import { GatewayLlmRuntime } from "../dist/llm-runtime.js";

describe("GatewayLlmRuntime", () => {
  it("resolves anthropic default config", () => {
    const runtime = new GatewayLlmRuntime();
    const resolved = runtime.resolve({
      JIHN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    });
    expect(resolved.providerId).toBe("anthropic");
    expect(resolved.model).toBe("claude-sonnet-4-6");
  });

  it("switches to haiku via alias", () => {
    const runtime = new GatewayLlmRuntime();
    const resolved = runtime.resolve({
      JIHN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
      JIHN_LLM_MODEL_ALIAS: "haiku",
    });
    expect(resolved.providerId).toBe("anthropic");
    expect(resolved.model).toBe("claude-3-5-haiku-latest");
  });

  it("uses sonnet profile override when alias=sonnet", () => {
    const runtime = new GatewayLlmRuntime();
    const resolved = runtime.resolve({
      JIHN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
      JIHN_ANTHROPIC_MODEL_SONNET: "claude-sonnet-4-6",
      JIHN_LLM_MODEL_ALIAS: "sonnet",
    });
    expect(resolved.model).toBe("claude-sonnet-4-6");
  });

  it("rejects non-default alias for openai provider", () => {
    const runtime = new GatewayLlmRuntime();
    expect(() =>
      runtime.resolve({
        JIHN_LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-openai-real-key",
        OPENAI_MODEL: "gpt-4.1",
        JIHN_LLM_MODEL_ALIAS: "haiku",
      }),
    ).toThrow("only supported with JIHN_LLM_PROVIDER=anthropic");
  });

  it("reuses provider client instances across resolves", () => {
    const runtime = new GatewayLlmRuntime();
    const first = runtime.resolve({
      JIHN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    });
    const second = runtime.resolve({
      JIHN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
      JIHN_LLM_MODEL_ALIAS: "haiku",
    });
    expect(first.client).toBe(second.client);
  });
});


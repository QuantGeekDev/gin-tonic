import { describe, expect, it } from "@jest/globals";

import {
  createAnthropicClient,
} from "../dist/infrastructure/anthropic-client.js";
import {
  DEFAULT_ANTHROPIC_MODEL,
  resolveAnthropicModel,
} from "../dist/providers/anthropic/config.js";

describe("anthropic-client helpers", () => {
  it("uses default model when env value is missing", () => {
    expect(resolveAnthropicModel(undefined)).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it("accepts supported Sonnet model values", () => {
    expect(resolveAnthropicModel("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(resolveAnthropicModel("claude-sonnet-4-5-20250929")).toBe(
      "claude-sonnet-4-5-20250929",
    );
  });

  it("rejects unsupported model values", () => {
    expect(() => resolveAnthropicModel("claude-3-5-sonnet-latest")).toThrow(
      "Unsupported ANTHROPIC_MODEL",
    );
  });

  it("requires API key", () => {
    expect(() => createAnthropicClient("")).toThrow("ANTHROPIC_API_KEY is required");
  });
});

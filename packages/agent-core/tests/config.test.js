import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TURNS,
  DEFAULT_SYSTEM_PROMPT,
  resolvePositiveInteger,
  resolveSystemPrompt,
} from "../dist/index.js";

describe("agent config defaults", () => {
  it("matches current defaults", () => {
    expect(DEFAULT_MAX_TURNS).toBe(20);
    expect(DEFAULT_MAX_TOKENS).toBe(1024);
    expect(DEFAULT_SYSTEM_PROMPT).toBe(
      "You are Jihn. Be concise, pragmatic, and use tools whenever they improve accuracy.",
    );
  });

  it("resolves system prompt with trim + fallback", () => {
    expect(resolveSystemPrompt(undefined)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(resolveSystemPrompt("   ")).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(resolveSystemPrompt("  custom prompt  ")).toBe("custom prompt");
  });

  it("resolves positive integer with fallback", () => {
    expect(resolvePositiveInteger(undefined, 7)).toBe(7);
    expect(resolvePositiveInteger("0", 7)).toBe(7);
    expect(resolvePositiveInteger("-2", 7)).toBe(7);
    expect(resolvePositiveInteger("abc", 7)).toBe(7);
    expect(resolvePositiveInteger("42", 7)).toBe(42);
  });
});

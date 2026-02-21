import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_OPENAI_MODEL,
  resolveOpenAIModel,
  createOpenAIClient,
} from "../dist/index.js";

describe("openai provider helpers", () => {
  it("uses default model when env value is missing", () => {
    expect(resolveOpenAIModel(undefined)).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("accepts explicit model values", () => {
    expect(resolveOpenAIModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveOpenAIModel("gpt-4.1")).toBe("gpt-4.1");
  });

  it("requires API key", () => {
    expect(() => createOpenAIClient("")).toThrow("OPENAI_API_KEY is required");
  });
});

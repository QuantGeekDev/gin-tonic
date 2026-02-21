import { describe, expect, it } from "@jest/globals";
import { validateGatewayLlmEnv } from "../dist/env-validation.js";

describe("validateGatewayLlmEnv", () => {
  it("allows valid OpenAI key", () => {
    expect(() =>
      validateGatewayLlmEnv({
        providerId: "openai",
        env: { OPENAI_API_KEY: "sk-live-realistic-key-value" },
      }),
    ).not.toThrow();
  });

  it("fails when required key is missing", () => {
    expect(() =>
      validateGatewayLlmEnv({
        providerId: "openai",
        env: {},
      }),
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("fails when key is obvious placeholder", () => {
    expect(() =>
      validateGatewayLlmEnv({
        providerId: "openai",
        env: { OPENAI_API_KEY: "replace_me" },
      }),
    ).toThrow("placeholder");
  });

  it("ignores unsupported provider ids", () => {
    expect(() =>
      validateGatewayLlmEnv({
        providerId: "custom-provider",
        env: {},
      }),
    ).not.toThrow();
  });
});

import { describe, expect, it } from "@jest/globals";

import {
  ToolAlreadyRegisteredError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolResultError,
} from "../dist/domain/errors.js";
import ToolRegistry from "../dist/tools/registry.js";

function createEchoTool() {
  return {
    definition: {
      name: "echo",
      description: "Echo text",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
    parseInput(rawInput) {
      if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
        throw new Error("Expected object input.");
      }

      const input = rawInput;
      if (typeof input.value !== "string") {
        throw new Error("'value' must be a string.");
      }

      return { value: input.value };
    },
    async handler(input) {
      return input.value;
    },
  };
}

describe("ToolRegistry", () => {
  it("executes a registered tool", async () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    await expect(registry.execute("echo", { value: "ok" })).resolves.toBe("ok");
  });

  it("throws on duplicate registration", () => {
    const registry = new ToolRegistry();
    const tool = createEchoTool();

    registry.register(tool);

    expect(() => registry.register(tool)).toThrow(ToolAlreadyRegisteredError);
  });

  it("throws a typed error for unknown tools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute("missing", {})).rejects.toThrow(ToolNotFoundError);
  });

  it.each([
    undefined,
    null,
    [],
    { value: 123 },
  ])("validates input before handler execution (%p)", async (invalidInput) => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    await expect(registry.execute("echo", invalidInput)).rejects.toThrow(
      ToolInputValidationError,
    );
  });

  it("accepts empty string as valid tool output", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "empty",
        description: "returns empty",
        inputSchema: { type: "object", additionalProperties: false },
      },
      parseInput() {
        return {};
      },
      async handler() {
        return "";
      },
    });

    await expect(registry.execute("empty", {})).resolves.toBe("");
  });

  it("fails when a tool returns null", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "bad_result",
        description: "returns null",
        inputSchema: { type: "object", additionalProperties: false },
      },
      parseInput() {
        return {};
      },
      async handler() {
        return null;
      },
    });

    await expect(registry.execute("bad_result", {})).rejects.toThrow(ToolResultError);
  });
});

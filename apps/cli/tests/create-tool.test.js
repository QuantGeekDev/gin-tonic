import { describe, expect, it } from "@jest/globals";

import {
  createTool,
  createToolDefinition,
  createToolFromDefinition,
} from "../dist/domain/create-tool.js";

describe("create-tool helpers", () => {
  it("creates definition with both schema key styles", () => {
    const schema = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    };

    const definition = createToolDefinition({
      name: "echo",
      description: "echo text",
      inputSchema: schema,
    });

    expect(definition).toMatchObject({
      name: "echo",
      description: "echo text",
      inputSchema: schema,
      input_schema: schema,
    });
  });

  it("builds tool from definition and implementation", async () => {
    const definition = createToolDefinition({
      name: "echo",
      description: "echo text",
      inputSchema: { type: "object", additionalProperties: false },
    });

    const tool = createToolFromDefinition(definition, {
      parseInput() {
        return { value: "ok" };
      },
      async handler(input) {
        return input.value;
      },
    });

    const parsedInput = tool.parseInput({});
    await expect(tool.handler(parsedInput)).resolves.toBe("ok");
  });

  it("keeps createTool as concise all-in-one helper", async () => {
    const tool = createTool({
      name: "ping",
      description: "ping pong",
      inputSchema: { type: "object", additionalProperties: false },
      parseInput() {
        return {};
      },
      async handler() {
        return "pong";
      },
    });

    await expect(tool.handler(tool.parseInput({}))).resolves.toBe("pong");
  });
});

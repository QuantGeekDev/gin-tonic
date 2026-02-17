import { createToolDefinition, createToolFromDefinition } from "../domain/create-tool.js";

interface HelloWorldInput {
  name?: string;
}

const HelloWorldToolDefinition = createToolDefinition({
  name: "hello_world",
  description: "Return a hello message. Optionally include a name.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    additionalProperties: false,
  },
});

export const HelloWorldTool = createToolFromDefinition<
  HelloWorldInput,
  string,
  "hello_world"
>(HelloWorldToolDefinition, {
  parseInput(rawInput) {
    if (rawInput === null || rawInput === undefined) {
      return {};
    }

    if (typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new Error("Expected an object input.");
    }

    const input = rawInput as Record<string, unknown>;
    if (input.name !== undefined && typeof input.name !== "string") {
      throw new Error("Field 'name' must be a string when provided.");
    }

    return input.name === undefined ? {} : { name: input.name };
  },
  handler(input) {
    return input.name ? `Hello ${input.name}` : "Hello world";
  },
});

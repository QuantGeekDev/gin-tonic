import { createToolDefinition, createToolFromDefinition } from "../domain/create-tool.js";

const CurrentTimeToolDefinition = createToolDefinition({
  name: "current_time",
  description: "Return the current UTC time in ISO-8601 format.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
});

export const CurrentTimeTool = createToolFromDefinition(CurrentTimeToolDefinition, {
  parseInput(rawInput) {
    if (rawInput === undefined || rawInput === null) {
      return {};
    }

    if (typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new Error("Expected an empty object input.");
    }

    return {};
  },
  handler() {
    return new Date().toISOString();
  },
});

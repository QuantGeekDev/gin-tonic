import { describe, expect, it } from "@jest/globals";

import { runAgentTurn } from "@jihn/agent-core";

describe("runAgentTurn", () => {
  it("returns assistant text on end_turn", async () => {
    const calls = [];
    const client = {
      messages: {
        async create(request) {
          calls.push(request);
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "hello" }],
          };
        },
      },
    };

    const result = await runAgentTurn({
      client,
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "system",
      tools: [],
      async executeTool() {
        return "";
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].max_tokens).toBe(1024);
    expect(result.text).toBe("hello");
    expect(result.messages[result.messages.length - 1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("uses configurable maxTokens when provided", async () => {
    const calls = [];
    const client = {
      messages: {
        async create(request) {
          calls.push(request);
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "ok" }],
          };
        },
      },
    };

    await runAgentTurn({
      client,
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "system",
      tools: [],
      maxTokens: 2048,
      async executeTool() {
        return "";
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].max_tokens).toBe(2048);
  });

  it("executes tool_use blocks and continues loop", async () => {
    let createCount = 0;
    const client = {
      messages: {
        async create() {
          createCount += 1;
          if (createCount === 1) {
            return {
              stop_reason: "tool_use",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_1",
                  name: "calculate",
                  input: { expression: "2 + 3" },
                },
              ],
            };
          }
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "5" }],
          };
        },
      },
    };

    const executed = [];
    const result = await runAgentTurn({
      client,
      messages: [{ role: "user", content: "what is 2 + 3?" }],
      systemPrompt: "system",
      tools: [],
      async executeTool(name, input) {
        executed.push({ name, input });
        return "5";
      },
    });

    expect(executed).toEqual([{ name: "calculate", input: { expression: "2 + 3" } }]);
    expect(result.text).toBe("5");
    const toolResultMessage = result.messages.find(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === "tool_result"),
    );
    expect(toolResultMessage).toBeDefined();
  });

  it("returns max-tool-turn message when limit is reached", async () => {
    const client = {
      messages: {
        async create() {
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "calculate",
                input: { expression: "1 + 1" },
              },
            ],
          };
        },
      },
    };

    const result = await runAgentTurn({
      client,
      messages: [{ role: "user", content: "loop forever" }],
      systemPrompt: "system",
      tools: [],
      maxTurns: 1,
      async executeTool() {
        return "2";
      },
    });

    expect(result.text).toBe("(max tool turns reached)");
  });
});

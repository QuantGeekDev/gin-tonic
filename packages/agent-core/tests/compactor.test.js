import { describe, expect, it } from "@jest/globals";

import { compactSessionMessages } from "../dist/index.js";

function buildMessage(role, content) {
  return { role, content };
}

describe("compactSessionMessages", () => {
  it("keeps messages unchanged when token budget is not exceeded", async () => {
    const messages = [
      buildMessage("user", "hello"),
      buildMessage("assistant", "hi"),
    ];
    const result = await compactSessionMessages(
      messages,
      { tokenBudget: 100 },
      async (value) => value.length * 10,
    );

    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it("compacts deterministically with summary + recent tail", async () => {
    const messages = [
      buildMessage("user", "u1"),
      buildMessage("assistant", "a1"),
      buildMessage("user", "u2"),
      buildMessage("assistant", "a2"),
      buildMessage("user", "u3"),
      buildMessage("assistant", "a3"),
      buildMessage("user", "u4"),
      buildMessage("assistant", "a4"),
      buildMessage("user", "u5"),
      buildMessage("assistant", "a5"),
    ];

    const tokenCounter = async (value) => value.length * 20;
    const first = await compactSessionMessages(
      messages,
      { tokenBudget: 120, targetTokenBudget: 100, preserveRecentMessages: 4 },
      tokenCounter,
    );
    const second = await compactSessionMessages(
      messages,
      { tokenBudget: 120, targetTokenBudget: 100, preserveRecentMessages: 4 },
      tokenCounter,
    );

    expect(first.compacted).toBe(true);
    expect(first.messages).toEqual(second.messages);
    expect(first.messages[0].role).toBe("assistant");
    expect(typeof first.messages[0].content).toBe("string");
    expect(first.messages[0].content).toContain("Session compaction summary");
  });
});


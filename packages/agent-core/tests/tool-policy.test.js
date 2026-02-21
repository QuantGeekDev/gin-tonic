import { describe, expect, it } from "@jest/globals";

import {
  ToolPolicyError,
  createPolicyExecutor,
  resolveToolPolicy,
} from "../dist/index.js";

describe("tool policy", () => {
  it("allow mode allows listed tools and blocks unlisted ones", async () => {
    const executeTool = createPolicyExecutor({
      executeTool: async (name) => `ok:${name}`,
      policy: { mode: "allow", toolNames: ["calculate"] },
    });

    await expect(executeTool("calculate", {})).resolves.toBe("ok:calculate");
    await expect(executeTool("current_time", {})).rejects.toThrow(ToolPolicyError);
  });

  it("deny mode blocks listed tools", async () => {
    const executeTool = createPolicyExecutor({
      executeTool: async (name) => `ok:${name}`,
      policy: { mode: "deny", toolNames: ["calculate"] },
    });

    await expect(executeTool("calculate", {})).rejects.toThrow(
      'Tool "calculate" blocked by policy mode "deny".',
    );
    await expect(executeTool("current_time", {})).resolves.toBe("ok:current_time");
  });

  it("review mode requires approval hook and blocks without it", async () => {
    const executeTool = createPolicyExecutor({
      executeTool: async (name) => `ok:${name}`,
      policy: { mode: "review" },
    });

    await expect(executeTool("calculate", {})).rejects.toThrow(
      "requires operator approval",
    );
  });

  it("review mode obeys approval hook decision", async () => {
    const executeTool = createPolicyExecutor({
      executeTool: async (name) => `ok:${name}`,
      policy: {
        mode: "review",
        requestApproval: async (context) => context.toolName === "calculate",
      },
    });

    await expect(executeTool("calculate", {})).resolves.toBe("ok:calculate");
    await expect(executeTool("current_time", {})).rejects.toThrow(
      'Tool "current_time" denied by operator review policy.',
    );
  });

  it("resolveToolPolicy parses mode and tool csv", () => {
    expect(resolveToolPolicy(undefined, "calculate")).toBeUndefined();
    expect(resolveToolPolicy("deny", "calculate,current_time")).toEqual({
      mode: "deny",
      toolNames: ["calculate", "current_time"],
    });
    expect(() => resolveToolPolicy("unknown", "")).toThrow(
      'Unsupported tool policy mode "unknown"',
    );
  });
});


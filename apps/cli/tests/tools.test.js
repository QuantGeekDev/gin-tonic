import { describe, expect, it } from "@jest/globals";

import { createSharedToolRuntime } from "@jihn/agent-core";

describe("custom tools", () => {
  describe("current_time", () => {
    it("returns an ISO timestamp", async () => {
      const runtime = createSharedToolRuntime();
      const output = await runtime.execute("current_time", {});
      expect(Number.isNaN(Date.parse(output))).toBe(false);
      expect(output).toContain("T");
    });
  });

  describe("calculate", () => {
    it("evaluates arithmetic expressions", async () => {
      const runtime = createSharedToolRuntime();
      await expect(
        runtime.execute("calculate", { expression: "1337 * 42" }),
      ).resolves.toBe("56154");
    });

    it.each([
      { expression: "" },
      { expression: "2 + abc" },
    ])("rejects invalid expression input (%p)", async (invalidInput) => {
      const runtime = createSharedToolRuntime();
      await expect(
        runtime.execute("calculate", invalidInput),
      ).rejects.toThrow();
    });
  });
});

import { describe, expect, it } from "@jest/globals";

import { CurrentTimeTool } from "../dist/custom_tools/current_time.tool.js";
import { CalculateTool } from "../dist/custom_tools/calculate.tool.js";

describe("custom tools", () => {
  describe("CurrentTimeTool", () => {
    it("returns an ISO timestamp", async () => {
      const input = CurrentTimeTool.parseInput({});
      const output = await CurrentTimeTool.handler(input);
      expect(Number.isNaN(Date.parse(output))).toBe(false);
      expect(output).toContain("T");
    });

    it.each([undefined, null, {}])("accepts empty input shape (%p)", (validInput) => {
      expect(() => CurrentTimeTool.parseInput(validInput)).not.toThrow();
    });

    it.each(["bad", []])(
      "rejects invalid input shape (%p)",
      (invalidInput) => {
        expect(() => CurrentTimeTool.parseInput(invalidInput)).toThrow();
      },
    );
  });

  describe("CalculateTool", () => {
    it("evaluates arithmetic expressions", async () => {
      const input = CalculateTool.parseInput({ expression: "1337 * 42" });
      expect(CalculateTool.handler(input)).toBe("56154");
    });

    it.each([
      { expression: "" },
      { expression: "2 + abc" },
      null,
      "bad",
    ])("rejects invalid expression input (%p)", (invalidInput) => {
      expect(() => CalculateTool.parseInput(invalidInput)).toThrow();
    });
  });
});

import { describe, expect, it } from "@jest/globals";

import { runCompletionCliCommand } from "../dist/commands/completion.js";

describe("runCompletionCliCommand", () => {
  it("returns false for non-completion commands", async () => {
    const logs = [];
    const handled = await runCompletionCliCommand(["settings"], {
      log: (line) => logs.push(line),
    });

    expect(handled).toBe(false);
    expect(logs).toEqual([]);
  });

  it("prints bash completion script", async () => {
    const logs = [];
    const handled = await runCompletionCliCommand(["completion", "bash"], {
      log: (line) => logs.push(line),
    });

    expect(handled).toBe(true);
    expect(logs.join("\n")).toContain("complete -F _jihn_complete jihn");
    expect(logs.join("\n")).toContain("jihn settings keys");
  });

  it("prints zsh completion script", async () => {
    const logs = [];
    await runCompletionCliCommand(["completion", "zsh"], {
      log: (line) => logs.push(line),
    });

    expect(logs.join("\n")).toContain("#compdef jihn");
    expect(logs.join("\n")).toContain("settings keys");
  });

  it("prints fish completion script", async () => {
    const logs = [];
    await runCompletionCliCommand(["completion", "fish"], {
      log: (line) => logs.push(line),
    });

    expect(logs.join("\n")).toContain("complete -c jihn");
    expect(logs.join("\n")).toContain("__jihn_settings_keys");
  });
});

import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeSystemPrompt } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createTempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-prompt-composer-"));
  tempDirs.push(dir);
  return dir;
}

describe("composeSystemPrompt", () => {
  it("returns default prompt when no prompt files exist", async () => {
    const workspaceDir = await createTempWorkspace();
    const prompt = await composeSystemPrompt({
      workspaceDir,
      defaultPrompt: "base-default",
    });

    expect(prompt).toBe("base-default");
  });

  it("includes workspace AGENTS/SOUL/TOOLS files in order", async () => {
    const workspaceDir = await createTempWorkspace();
    await writeFile(join(workspaceDir, "AGENTS.md"), "agents content\n");
    await writeFile(join(workspaceDir, "SOUL.md"), "soul content\n");
    await writeFile(join(workspaceDir, "TOOLS.md"), "tools content\n");

    const prompt = await composeSystemPrompt({
      workspaceDir,
      defaultPrompt: "base-default",
    });

    expect(prompt).toContain("base-default");
    expect(prompt).toContain("### Workspace AGENTS.md");
    expect(prompt).toContain("agents content");
    expect(prompt).toContain("### Workspace SOUL.md");
    expect(prompt).toContain("soul content");
    expect(prompt).toContain("### Workspace TOOLS.md");
    expect(prompt).toContain("tools content");
  });

  it("includes optional per-agent prompt files after workspace files", async () => {
    const workspaceDir = await createTempWorkspace();
    await writeFile(join(workspaceDir, "AGENTS.md"), "workspace-agents\n");

    const agentDir = join(workspaceDir, "agents", "main");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "AGENTS.md"), "agent-agents\n");
    await writeFile(join(agentDir, "TOOLS.md"), "agent-tools\n");

    const prompt = await composeSystemPrompt({
      workspaceDir,
      agentId: "main",
      defaultPrompt: "base-default",
    });

    expect(prompt).toContain("### Workspace AGENTS.md");
    expect(prompt).toContain("workspace-agents");
    expect(prompt).toContain("### Agent main AGENTS.md");
    expect(prompt).toContain("agent-agents");
    expect(prompt).toContain("### Agent main TOOLS.md");
    expect(prompt).toContain("agent-tools");
  });
});


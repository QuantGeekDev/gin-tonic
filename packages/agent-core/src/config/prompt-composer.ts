import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_SYSTEM_PROMPT } from "./agent.js";
import type { PluginRuntime } from "../plugins/runtime.js";

const PROMPT_FILE_NAMES = ["AGENTS.md", "SOUL.md", "TOOLS.md"] as const;
const DEFAULT_AGENTS_DIRECTORY = "agents";

export interface ComposeSystemPromptOptions {
  workspaceDir?: string;
  agentId?: string;
  agentsDirectoryName?: string;
  defaultPrompt?: string;
  pluginRuntime?: PluginRuntime;
}

function sanitizeDirectorySegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function readOptionalUtf8File(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    if (isMissing) {
      return null;
    }
    throw error;
  }
}

function buildHeader(label: string): string {
  return `### ${label}`;
}

export async function composeSystemPrompt(
  options: ComposeSystemPromptOptions = {},
): Promise<string> {
  const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
  const defaultPrompt = (options.defaultPrompt ?? DEFAULT_SYSTEM_PROMPT).trim();
  const agentsDirectoryName = options.agentsDirectoryName ?? DEFAULT_AGENTS_DIRECTORY;
  const agentId =
    options.agentId === undefined ? null : sanitizeDirectorySegment(options.agentId);
  const sections: string[] = [defaultPrompt];

  for (const fileName of PROMPT_FILE_NAMES) {
    const workspacePath = join(workspaceDir, fileName);
    const workspaceContent = await readOptionalUtf8File(workspacePath);
    if (workspaceContent !== null) {
      sections.push(`${buildHeader(`Workspace ${fileName}`)}\n${workspaceContent}`);
    }

    if (agentId === null || agentId.length === 0) {
      continue;
    }

    const agentPath = join(workspaceDir, agentsDirectoryName, agentId, fileName);
    const agentContent = await readOptionalUtf8File(agentPath);
    if (agentContent !== null) {
      sections.push(`${buildHeader(`Agent ${agentId} ${fileName}`)}\n${agentContent}`);
    }
  }

  const combined = sections.join("\n\n");
  if (options.pluginRuntime === undefined) {
    return combined;
  }
  return options.pluginRuntime.applyPromptHooks(combined, {
    workspaceDir,
    ...(agentId !== null ? { agentId } : {}),
  });
}

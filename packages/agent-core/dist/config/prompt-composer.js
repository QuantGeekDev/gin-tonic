import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_SYSTEM_PROMPT } from "./agent.js";
const PROMPT_FILE_NAMES = ["AGENTS.md", "SOUL.md", "TOOLS.md"];
const DEFAULT_AGENTS_DIRECTORY = "agents";
function sanitizeDirectorySegment(value) {
    return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
}
async function readOptionalUtf8File(filePath) {
    try {
        const content = await readFile(filePath, "utf8");
        const trimmed = content.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    catch (error) {
        const isMissing = typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT";
        if (isMissing) {
            return null;
        }
        throw error;
    }
}
function buildHeader(label) {
    return `### ${label}`;
}
export async function composeSystemPrompt(options = {}) {
    const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
    const defaultPrompt = (options.defaultPrompt ?? DEFAULT_SYSTEM_PROMPT).trim();
    const agentsDirectoryName = options.agentsDirectoryName ?? DEFAULT_AGENTS_DIRECTORY;
    const agentId = options.agentId === undefined ? null : sanitizeDirectorySegment(options.agentId);
    const sections = [defaultPrompt];
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
    return sections.join("\n\n");
}
//# sourceMappingURL=prompt-composer.js.map
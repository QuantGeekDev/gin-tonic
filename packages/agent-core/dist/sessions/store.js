import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { resolveSessionsDirectory } from "./location.js";
const CURRENT_MANIFEST_FILE = "CURRENT.json";
const VERSION_FILE_PREFIX = "v";
const VERSION_FILE_EXTENSION = ".jsonl";
function sanitizeSessionKey(value) {
    const sanitized = value.trim().replace(/[<>:"/\\|?*\s]+/g, "_");
    return sanitized.length > 0 ? sanitized : "session";
}
function buildVersionFileName(version) {
    const padded = String(version).padStart(6, "0");
    return `${VERSION_FILE_PREFIX}${padded}${VERSION_FILE_EXTENSION}`;
}
function isMessage(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value;
    const validRole = candidate.role === "user" || candidate.role === "assistant";
    const validContent = typeof candidate.content === "string" || Array.isArray(candidate.content);
    return validRole && validContent;
}
async function atomicWriteFile(filePath, content) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
}
export class SessionStore {
    sessionsDirectoryPath;
    constructor(sessionsDirectory = resolveSessionsDirectory()) {
        this.sessionsDirectoryPath = sessionsDirectory;
    }
    get sessionsDirectory() {
        return this.sessionsDirectoryPath;
    }
    resolveSessionDirectoryPath(sessionKey) {
        return join(this.sessionsDirectoryPath, sanitizeSessionKey(sessionKey));
    }
    resolveSessionManifestPath(sessionKey) {
        return join(this.resolveSessionDirectoryPath(sessionKey), CURRENT_MANIFEST_FILE);
    }
    async ensureSessionsDirectory() {
        await mkdir(this.sessionsDirectoryPath, { recursive: true });
    }
    async ensureSessionDirectory(sessionKey) {
        await this.ensureSessionsDirectory();
        await mkdir(this.resolveSessionDirectoryPath(sessionKey), { recursive: true });
    }
    async readManifest(sessionKey) {
        try {
            const raw = await readFile(this.resolveSessionManifestPath(sessionKey), "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                return null;
            }
            const manifest = parsed;
            if (typeof manifest.version !== "number" ||
                !Number.isInteger(manifest.version) ||
                manifest.version < 1 ||
                typeof manifest.activeFile !== "string" ||
                manifest.activeFile.trim().length === 0) {
                return null;
            }
            return {
                version: manifest.version,
                activeFile: manifest.activeFile,
            };
        }
        catch (error) {
            const notFound = typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "ENOENT";
            if (notFound) {
                return null;
            }
            throw error;
        }
    }
    async writeManifest(sessionKey, manifest) {
        const manifestPath = this.resolveSessionManifestPath(sessionKey);
        await atomicWriteFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    }
    resolveVersionFilePath(sessionKey, fileName) {
        const safeFileName = basename(fileName);
        return join(this.resolveSessionDirectoryPath(sessionKey), safeFileName);
    }
    async ensureInitialized(sessionKey) {
        await this.ensureSessionDirectory(sessionKey);
        const existing = await this.readManifest(sessionKey);
        if (existing !== null) {
            return existing;
        }
        const manifest = {
            version: 1,
            activeFile: buildVersionFileName(1),
        };
        const initialFile = this.resolveVersionFilePath(sessionKey, manifest.activeFile);
        await atomicWriteFile(initialFile, "");
        await this.writeManifest(sessionKey, manifest);
        return manifest;
    }
    async load(sessionKey) {
        const manifest = await this.readManifest(sessionKey);
        if (manifest === null) {
            return [];
        }
        const activeFilePath = this.resolveVersionFilePath(sessionKey, manifest.activeFile);
        const stream = createReadStream(activeFilePath, { encoding: "utf8" });
        const lines = createInterface({
            input: stream,
            crlfDelay: Infinity,
        });
        const messages = [];
        try {
            for await (const rawLine of lines) {
                const line = rawLine.trim();
                if (line.length === 0) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(line);
                    if (isMessage(parsed)) {
                        messages.push(parsed);
                    }
                }
                catch {
                    continue;
                }
            }
        }
        catch (error) {
            const notFound = typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "ENOENT";
            if (notFound) {
                return [];
            }
            throw error;
        }
        return messages;
    }
    async append(sessionKey, message) {
        const manifest = await this.ensureInitialized(sessionKey);
        const activeFilePath = this.resolveVersionFilePath(sessionKey, manifest.activeFile);
        await appendFile(activeFilePath, `${JSON.stringify(message)}\n`, "utf8");
    }
    async save(sessionKey, messages) {
        const manifest = await this.ensureInitialized(sessionKey);
        const nextVersion = manifest.version + 1;
        const nextFileName = buildVersionFileName(nextVersion);
        const nextFilePath = this.resolveVersionFilePath(sessionKey, nextFileName);
        const lines = messages.map((message) => JSON.stringify(message));
        const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
        await atomicWriteFile(nextFilePath, content);
        await this.writeManifest(sessionKey, {
            version: nextVersion,
            activeFile: nextFileName,
        });
    }
}
//# sourceMappingURL=store.js.map
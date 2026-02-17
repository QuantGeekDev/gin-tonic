import type { Message } from "../types/message.js";
export declare class SessionStore {
    private readonly sessionsDirectoryPath;
    constructor(sessionsDirectory?: string);
    get sessionsDirectory(): string;
    resolveSessionDirectoryPath(sessionKey: string): string;
    resolveSessionManifestPath(sessionKey: string): string;
    ensureSessionsDirectory(): Promise<void>;
    private ensureSessionDirectory;
    private readManifest;
    private writeManifest;
    private resolveVersionFilePath;
    private ensureInitialized;
    load(sessionKey: string): Promise<Message[]>;
    append(sessionKey: string, message: Message): Promise<void>;
    save(sessionKey: string, messages: Message[]): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map
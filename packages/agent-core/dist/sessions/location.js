import { homedir } from "node:os";
import { resolve } from "node:path";
export const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".jihn", "sessions");
export function resolveSessionsDirectory() {
    const override = process.env.JIHN_SESSIONS_DIR;
    if (override !== undefined && override.trim().length > 0) {
        return resolve(override);
    }
    return DEFAULT_SESSIONS_DIR;
}
//# sourceMappingURL=location.js.map
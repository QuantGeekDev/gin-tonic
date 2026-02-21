import { z } from "zod";
export const STORAGE_BACKENDS = ["file", "postgres"];
export function resolveStorageBackend(env = process.env) {
    const raw = z
        .object({ JIHN_STORAGE_BACKEND: z.string().optional() })
        .parse(env)
        .JIHN_STORAGE_BACKEND
        ?.trim()
        .toLowerCase();
    if (raw === "postgres") {
        return "postgres";
    }
    return "file";
}
//# sourceMappingURL=config.js.map
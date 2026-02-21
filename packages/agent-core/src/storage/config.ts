import { z } from "zod";

export const STORAGE_BACKENDS = ["file", "postgres"] as const;

export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

export function resolveStorageBackend(
  env: NodeJS.ProcessEnv = process.env,
): StorageBackend {
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

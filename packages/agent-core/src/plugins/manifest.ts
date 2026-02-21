import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_EXECUTION_MODES,
  PLUGIN_HOOK_NAMES,
  PLUGIN_PERMISSIONS,
  PLUGIN_TRUST_TIERS,
  type PluginManifest,
} from "./types.js";

export const PLUGIN_MANIFEST_FILENAME = "jihn.plugin.json";
const DEFAULT_PLUGINS_DIR = "plugins";

const HookPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    onError: z.enum(["continue", "fail"]).optional(),
  })
  .strict();

const PluginManifestSchema = z
  .object({
    id: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(40),
    apiVersion: z.number().int().positive().default(1),
    entry: z.string().trim().min(1).default("index.js"),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(-1000).max(1000).default(0),
    capabilities: z.array(z.enum(PLUGIN_CAPABILITIES)).min(1),
    permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).optional(),
    executionMode: z.enum(PLUGIN_EXECUTION_MODES).optional(),
    compatibility: z
      .object({
        minHostVersion: z.string().trim().min(1).max(40).optional(),
        maxHostVersion: z.string().trim().min(1).max(40).optional(),
      })
      .strict()
      .optional(),
    healthcheck: z
      .object({
        timeoutMs: z.number().int().positive().max(60_000).optional(),
      })
      .strict()
      .optional(),
    hookPolicy: HookPolicySchema.optional(),
    hookPolicies: z.partialRecord(z.enum(PLUGIN_HOOK_NAMES), HookPolicySchema).optional(),
    dependencies: z.array(z.string().trim().min(1).max(100)).optional(),
    description: z.string().trim().min(1).max(600).optional(),
    trustTier: z.enum(PLUGIN_TRUST_TIERS).optional(),
  })
  .strict();

export interface PluginManifestDiskEntry {
  rootDir: string;
  manifestPath: string;
  manifest: PluginManifest;
}

export async function loadPluginManifest(
  pluginRootDir: string,
): Promise<PluginManifestDiskEntry> {
  const rootDir = resolve(pluginRootDir);
  const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME);
  const raw = await readFile(manifestPath, "utf8");
  const json = JSON.parse(raw) as unknown;
  const manifest = PluginManifestSchema.parse(json);
  return {
    rootDir,
    manifestPath,
    manifest,
  };
}

export async function discoverPluginManifests(options: {
  workspaceDir?: string;
  pluginsDirectoryName?: string;
} = {}): Promise<PluginManifestDiskEntry[]> {
  const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
  const pluginsDir = join(
    workspaceDir,
    options.pluginsDirectoryName ?? DEFAULT_PLUGINS_DIR,
  );

  let entries: string[] = [];
  try {
    entries = await readdir(pluginsDir);
  } catch (error) {
    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    if (isMissing) {
      return [];
    }
    throw error;
  }

  const manifests = await Promise.all(
    entries.map(async (entry) => {
      const rootDir = join(pluginsDir, entry);
      try {
        return await loadPluginManifest(rootDir);
      } catch {
        return null;
      }
    }),
  );

  return manifests
    .filter((item): item is PluginManifestDiskEntry => item !== null)
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function parsePluginManifest(input: unknown): PluginManifest {
  return PluginManifestSchema.parse(input);
}

import { z } from "zod";
import type {
  JihnPlugin,
  JihnPluginFactory,
  PluginManifest,
} from "@jihn/agent-core";

const PluginManifestInputSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    apiVersion: z.number().int().positive().default(1),
    entry: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().optional(),
    capabilities: z.array(z.enum(["tools", "prompt", "turn", "tool_intercept"])).min(1),
    permissions: z.array(z.string().trim().min(1)).optional(),
    dependencies: z.array(z.string().trim().min(1)).optional(),
    description: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type PluginManifestInput = z.input<typeof PluginManifestInputSchema>;

export interface PluginDefinition {
  manifest: PluginManifest;
  create: JihnPluginFactory;
}

export function definePlugin(
  manifestInput: PluginManifestInput,
  create: JihnPluginFactory,
): PluginDefinition {
  const parsed = PluginManifestInputSchema.parse(manifestInput);
  const manifest: PluginManifest = {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    apiVersion: parsed.apiVersion,
    entry: parsed.entry ?? "index.js",
    enabled: parsed.enabled ?? true,
    priority: parsed.priority ?? 0,
    capabilities: parsed.capabilities,
    ...(parsed.permissions !== undefined ? { permissions: parsed.permissions as PluginManifest["permissions"] } : {}),
    ...(parsed.dependencies !== undefined ? { dependencies: parsed.dependencies } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
  };
  return {
    manifest,
    create,
  };
}

export function createPluginModule(plugin: JihnPlugin | JihnPluginFactory): { default: typeof plugin } {
  return { default: plugin };
}

export type {
  JihnPlugin,
  JihnPluginFactory,
  PluginCapability,
  PluginContext,
  PluginEvent,
  PluginEventName,
  PluginHookName,
  PluginManifest,
  PluginMemoryAccessor,
  PluginNetworkAccessor,
  PluginPermission,
  PluginSessionAccessor,
} from "@jihn/agent-core";

import { z } from "zod";
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
export function definePlugin(manifestInput, create) {
    const parsed = PluginManifestInputSchema.parse(manifestInput);
    const manifest = {
        id: parsed.id,
        name: parsed.name,
        version: parsed.version,
        apiVersion: parsed.apiVersion,
        entry: parsed.entry ?? "index.js",
        enabled: parsed.enabled ?? true,
        priority: parsed.priority ?? 0,
        capabilities: parsed.capabilities,
        ...(parsed.permissions !== undefined ? { permissions: parsed.permissions } : {}),
        ...(parsed.dependencies !== undefined ? { dependencies: parsed.dependencies } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    };
    return {
        manifest,
        create,
    };
}
export function createPluginModule(plugin) {
    return { default: plugin };
}
//# sourceMappingURL=index.js.map
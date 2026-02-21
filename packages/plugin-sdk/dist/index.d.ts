import { z } from "zod";
import type { JihnPlugin, JihnPluginFactory, PluginManifest } from "@jihn/agent-core";
declare const PluginManifestInputSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    apiVersion: z.ZodDefault<z.ZodNumber>;
    entry: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    priority: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodArray<z.ZodEnum<{
        tools: "tools";
        prompt: "prompt";
        turn: "turn";
        tool_intercept: "tool_intercept";
    }>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString>>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export type PluginManifestInput = z.input<typeof PluginManifestInputSchema>;
export interface PluginDefinition {
    manifest: PluginManifest;
    create: JihnPluginFactory;
}
export declare function definePlugin(manifestInput: PluginManifestInput, create: JihnPluginFactory): PluginDefinition;
export declare function createPluginModule(plugin: JihnPlugin | JihnPluginFactory): {
    default: typeof plugin;
};
export type { JihnPlugin, JihnPluginFactory, PluginCapability, PluginContext, PluginEvent, PluginEventName, PluginHookName, PluginManifest, PluginMemoryAccessor, PluginNetworkAccessor, PluginPermission, PluginSessionAccessor, } from "@jihn/agent-core";
//# sourceMappingURL=index.d.ts.map
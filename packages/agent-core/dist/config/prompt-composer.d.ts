import type { PluginRuntime } from "../plugins/runtime.js";
export interface ComposeSystemPromptOptions {
    workspaceDir?: string;
    agentId?: string;
    agentsDirectoryName?: string;
    defaultPrompt?: string;
    pluginRuntime?: PluginRuntime;
}
export declare function composeSystemPrompt(options?: ComposeSystemPromptOptions): Promise<string>;
//# sourceMappingURL=prompt-composer.d.ts.map
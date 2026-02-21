import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
let loadedPlugin = null;
const toolMap = new Map();
const hookNames = [];
function respond(response) {
    parentPort?.postMessage(response);
}
async function handleLoad(request) {
    try {
        const moduleValue = await import(pathToFileURL(request.entryPath).href);
        const raw = moduleValue.default ?? moduleValue.plugin;
        if (raw === undefined) {
            respond({ id: request.id, ok: false, error: "plugin module missing export" });
            return;
        }
        let plugin;
        if (typeof raw === "object" && raw !== null && "manifest" in raw && "create" in raw) {
            plugin = typeof raw.create === "function" ? await raw.create() : raw;
        }
        else if (typeof raw === "function") {
            plugin = await raw();
        }
        else {
            plugin = raw;
        }
        loadedPlugin = plugin;
        toolMap.clear();
        hookNames.length = 0;
        const names = [];
        for (const tool of plugin.tools ?? []) {
            toolMap.set(tool.name, tool);
            names.push(tool.name);
        }
        if (plugin.hooks) {
            for (const key of Object.keys(plugin.hooks)) {
                hookNames.push(key);
            }
        }
        respond({ id: request.id, ok: true, toolNames: names, hookNames });
    }
    catch (error) {
        respond({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function handleExecuteHook(request) {
    if (!loadedPlugin?.hooks) {
        respond({ id: request.id, ok: false, error: "no hooks loaded" });
        return;
    }
    const hookMap = {
        beforePromptCompose: loadedPlugin.hooks.beforePromptCompose,
        afterPromptCompose: loadedPlugin.hooks.afterPromptCompose,
        beforeTurn: loadedPlugin.hooks.beforeTurn,
        afterTurn: loadedPlugin.hooks.afterTurn,
        beforeToolCall: loadedPlugin.hooks.beforeToolCall,
        afterToolCall: loadedPlugin.hooks.afterToolCall,
    };
    const hook = hookMap[request.hookName];
    if (!hook) {
        respond({ id: request.id, ok: true, result: undefined });
        return;
    }
    try {
        const result = await Promise.resolve(hook(request.event));
        respond({ id: request.id, ok: true, result: result ?? undefined });
    }
    catch (error) {
        respond({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function handleExecuteTool(request) {
    const tool = toolMap.get(request.toolName);
    if (!tool) {
        respond({ id: request.id, ok: false, error: `unknown tool: ${request.toolName}` });
        return;
    }
    try {
        const result = await tool.execute(request.input);
        respond({ id: request.id, ok: true, result });
    }
    catch (error) {
        respond({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function handleLifecycle(request) {
    if (!loadedPlugin?.lifecycle) {
        respond({ id: request.id, ok: true });
        return;
    }
    const hookMap = {
        onInstall: loadedPlugin.lifecycle.onInstall,
        onEnable: loadedPlugin.lifecycle.onEnable,
        onDisable: loadedPlugin.lifecycle.onDisable,
        onUnload: loadedPlugin.lifecycle.onUnload,
    };
    const hook = hookMap[request.hookName];
    if (!hook) {
        respond({ id: request.id, ok: true });
        return;
    }
    try {
        await Promise.resolve(hook(request.context));
        respond({ id: request.id, ok: true });
    }
    catch (error) {
        respond({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function handleHealthcheck(request) {
    if (!loadedPlugin?.lifecycle?.onHealthCheck) {
        respond({ id: request.id, ok: true, result: { healthy: true } });
        return;
    }
    try {
        const result = await Promise.resolve(loadedPlugin.lifecycle.onHealthCheck(request.context));
        respond({ id: request.id, ok: true, result: result ?? { healthy: true } });
    }
    catch (error) {
        respond({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
parentPort?.on("message", (message) => {
    switch (message.type) {
        case "load":
            handleLoad(message).catch((error) => {
                respond({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            break;
        case "execute_hook":
            handleExecuteHook(message).catch((error) => {
                respond({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            break;
        case "execute_tool":
            handleExecuteTool(message).catch((error) => {
                respond({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            break;
        case "lifecycle":
            handleLifecycle(message).catch((error) => {
                respond({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            break;
        case "healthcheck":
            handleHealthcheck(message).catch((error) => {
                respond({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            break;
        case "shutdown":
            if (loadedPlugin?.lifecycle?.onUnload) {
                Promise.resolve(loadedPlugin.lifecycle.onUnload({
                    pluginId: "",
                    nowIso: new Date().toISOString(),
                }))
                    .catch(() => { })
                    .finally(() => {
                    respond({ id: message.id, ok: true });
                });
            }
            else {
                respond({ id: message.id, ok: true });
            }
            break;
    }
});
//# sourceMappingURL=worker-runtime.js.map
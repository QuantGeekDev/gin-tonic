export const PLUGIN_CAPABILITIES = [
    "tools",
    "prompt",
    "turn",
    "tool_intercept",
];
export const PLUGIN_HOOK_NAMES = [
    "before_prompt_compose",
    "after_prompt_compose",
    "before_turn",
    "after_turn",
    "before_tool_call",
    "after_tool_call",
];
export const PLUGIN_PERMISSIONS = [
    "memory.read",
    "memory.write",
    "session.read",
    "session.write",
    "channel.send",
    "channel.receive",
    "network.http",
    "filesystem.read",
    "filesystem.write",
];
export const PLUGIN_EVENT_NAMES = [
    "plugin.loaded",
    "plugin.failed",
    "plugin.disabled",
    "plugin.hook.started",
    "plugin.hook.completed",
    "plugin.hook.timed_out",
    "plugin.tool.executed",
    "plugin.permission.denied",
];
//# sourceMappingURL=types.js.map
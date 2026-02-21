import { describe, expect, it } from "@jest/globals";

import { runSettingsCliCommand } from "../dist/commands/settings.js";

function createMockClient(params) {
  const state = {
    connectCalls: [],
    requestCalls: [],
    closed: false,
  };

  const client = {
    async connect(options) {
      state.connectCalls.push(options);
    },
    async request(method, payload) {
      state.requestCalls.push({ method, payload });
      if (params?.request) {
        return await params.request(method, payload);
      }
      return {};
    },
    async close() {
      state.closed = true;
    },
  };

  return { client, state };
}

describe("runSettingsCliCommand", () => {
  it("returns false for non-settings commands", async () => {
    const logs = [];
    const { client } = createMockClient();

    const handled = await runSettingsCliCommand(["mcp", "list"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(handled).toBe(false);
    expect(logs).toEqual([]);
  });

  it("lists settings through gateway snapshot", async () => {
    const logs = [];
    const { client, state } = createMockClient({
      async request(method) {
        expect(method).toBe("settings.snapshot");
        return {
          settingsFilePath: ".jihn/runtime-settings.json",
          generatedAt: "2026-01-01T00:00:00.000Z",
          definitions: [
            {
              key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
              category: "gateway",
              description: "limit",
              applyMode: "hot",
            },
          ],
          values: [
            {
              key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
              value: "120",
              updatedAt: "2026-01-01T00:00:00.000Z",
              updatedBy: "cli",
            },
          ],
        };
      },
    });

    const handled = await runSettingsCliCommand(["settings", "list"], {
      createClient: () => client,
      env: {
        JIHN_GATEWAY_URL: "ws://localhost:18789/ws",
        JIHN_GATEWAY_TOKEN: "token",
      },
      log: (line) => logs.push(line),
    });

    expect(handled).toBe(true);
    expect(state.connectCalls).toHaveLength(1);
    expect(state.closed).toBe(true);
    expect(logs.join("\n")).toContain("JIHN_GATEWAY_RATE_LIMIT_REQUESTS");
    expect(logs.join("\n")).toContain("mode=hot");
  });

  it("gets one setting value", async () => {
    const logs = [];
    const { client } = createMockClient({
      async request() {
        return {
          settingsFilePath: ".jihn/runtime-settings.json",
          generatedAt: "2026-01-01T00:00:00.000Z",
          definitions: [],
          values: [
            {
              key: "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS",
              value: "60000",
              updatedAt: "2026-01-01T00:00:00.000Z",
              updatedBy: "cli",
            },
          ],
        };
      },
    });

    await runSettingsCliCommand(["settings", "get", "--key", "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(logs[0]).toBe("JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS=60000");
  });

  it("sets one setting value", async () => {
    const logs = [];
    const { client, state } = createMockClient({
      async request(method, payload) {
        expect(method).toBe("settings.update");
        expect(payload).toEqual({
          key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
          value: "200",
        });
        return {
          key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
          value: "200",
          applyMode: "hot",
          applied: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    await runSettingsCliCommand(
      ["settings", "set", "--key", "JIHN_GATEWAY_RATE_LIMIT_REQUESTS", "--value", "200"],
      {
        createClient: () => client,
        env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
        log: (line) => logs.push(line),
      },
    );

    expect(state.requestCalls).toHaveLength(1);
    expect(logs.join("\n")).toContain("updated JIHN_GATEWAY_RATE_LIMIT_REQUESTS=200");
    expect(logs.join("\n")).toContain("apply_mode=hot");
  });

  it("prints setting keys for completion", async () => {
    const logs = [];
    const { client } = createMockClient({
      async request() {
        return {
          settingsFilePath: ".jihn/runtime-settings.json",
          generatedAt: "2026-01-01T00:00:00.000Z",
          definitions: [
            {
              key: "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS",
              category: "gateway",
              description: "window",
              applyMode: "hot",
            },
            {
              key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
              category: "gateway",
              description: "limit",
              applyMode: "hot",
            },
          ],
          values: [],
        };
      },
    });

    await runSettingsCliCommand(["settings", "keys"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(logs).toEqual([
      "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
      "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS",
    ]);
  });

  it("switches model alias via settings model --alias", async () => {
    const logs = [];
    const { client, state } = createMockClient({
      async request(method, payload) {
        expect(method).toBe("settings.update");
        expect(payload).toEqual({
          key: "JIHN_LLM_MODEL_ALIAS",
          value: "haiku",
        });
        return {
          key: "JIHN_LLM_MODEL_ALIAS",
          value: "haiku",
          applyMode: "hot",
          applied: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    await runSettingsCliCommand(["settings", "model", "--alias", "haiku"], {
      createClient: () => client,
      env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
      log: (line) => logs.push(line),
    });

    expect(state.requestCalls).toHaveLength(1);
    expect(logs.join("\n")).toContain("active_model_alias=haiku");
  });

  it("switches explicit model id and resets alias to default", async () => {
    const logs = [];
    const { client, state } = createMockClient({
      async request(_method, payload) {
        if (payload.key === "ANTHROPIC_MODEL") {
          return {
            key: "ANTHROPIC_MODEL",
            value: payload.value,
            applyMode: "hot",
            applied: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
          };
        }
        return {
          key: "JIHN_LLM_MODEL_ALIAS",
          value: "default",
          applyMode: "hot",
          applied: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    await runSettingsCliCommand(
      ["settings", "model", "--id", "claude-sonnet-4-6"],
      {
        createClient: () => client,
        env: { JIHN_GATEWAY_URL: "ws://localhost:18789/ws" },
        log: (line) => logs.push(line),
      },
    );

    expect(state.requestCalls).toEqual([
      {
        method: "settings.update",
        payload: { key: "ANTHROPIC_MODEL", value: "claude-sonnet-4-6" },
      },
      {
        method: "settings.update",
        payload: { key: "JIHN_LLM_MODEL_ALIAS", value: "default" },
      },
    ]);
    expect(logs.join("\n")).toContain("active_model_id=claude-sonnet-4-6");
    expect(logs.join("\n")).toContain("alias=default");
  });
});

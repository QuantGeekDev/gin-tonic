import { JihnGatewayClient } from "@jihn/gateway-client";

interface SettingsSnapshot {
  settingsFilePath: string;
  generatedAt: string;
  definitions: Array<{
    key: string;
    category: string;
    description: string;
    applyMode: "hot" | "restart_required";
  }>;
  values: Array<{
    key: string;
    value: string;
    updatedAt: string;
    updatedBy: string;
  }>;
}

interface SettingsUpdateResult {
  key: string;
  value: string;
  applyMode: "hot" | "restart_required";
  applied: boolean;
  updatedAt: string;
}

interface GatewayClientLike {
  connect(options: {
    url: string;
    authToken?: string;
    client: {
      id: string;
      name?: string;
      version?: string;
      capabilities?: string[];
    };
  }): Promise<void>;
  request<TResult = unknown>(
    method: string,
    payload: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<TResult>;
  close(): Promise<void>;
}

interface SettingsCommandDeps {
  createClient: () => GatewayClientLike;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

function readFlag(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || !names.includes(arg)) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

function hasFlag(args: string[], names: string[]): boolean {
  return args.some((arg) => names.includes(arg));
}

function requireGatewayUrl(env: NodeJS.ProcessEnv): string {
  const value = env.JIHN_GATEWAY_URL?.trim();
  if (!value) {
    throw new Error("settings commands require JIHN_GATEWAY_URL");
  }
  return value;
}

function defaultDeps(): SettingsCommandDeps {
  return {
    createClient: () => new JihnGatewayClient(),
    env: process.env,
    log: (line: string) => console.log(line),
  };
}

export function printSettingsUsage(log: (line: string) => void = (line) => console.log(line)): void {
  log("Settings commands:");
  log("  jihn settings list");
  log("  jihn settings get --key <SETTING_KEY>");
  log("  jihn settings set --key <SETTING_KEY> --value <VALUE>");
  log("  jihn settings model --alias <default|sonnet|haiku>");
  log("  jihn settings model --id <MODEL_ID>");
  log("  jihn settings keys");
}

function pickValue(snapshot: SettingsSnapshot, key: string): { value: string; updatedAt: string; updatedBy: string } | null {
  const found = snapshot.values.find((item) => item.key === key);
  if (!found) {
    return null;
  }
  return {
    value: found.value,
    updatedAt: found.updatedAt,
    updatedBy: found.updatedBy,
  };
}

function printList(snapshot: SettingsSnapshot, log: (line: string) => void): void {
  log(`settings_file: ${snapshot.settingsFilePath}`);
  log(`generated_at: ${snapshot.generatedAt}`);
  if (snapshot.definitions.length === 0) {
    log("No settings definitions available.");
    return;
  }

  for (const definition of snapshot.definitions) {
    const current = pickValue(snapshot, definition.key);
    log(
      [
        definition.key,
        `category=${definition.category}`,
        `mode=${definition.applyMode}`,
        `value=${current ? current.value : "(unset)"}`,
        ...(current ? [`updated_by=${current.updatedBy}`, `updated_at=${current.updatedAt}`] : []),
      ].join(" | "),
    );
  }
}

async function withGatewayClient<T>(
  deps: SettingsCommandDeps,
  task: (client: GatewayClientLike) => Promise<T>,
): Promise<T> {
  const gatewayUrl = requireGatewayUrl(deps.env);
  const client = deps.createClient();
  await client.connect({
    url: gatewayUrl,
    ...(deps.env.JIHN_GATEWAY_TOKEN !== undefined
      ? { authToken: deps.env.JIHN_GATEWAY_TOKEN }
      : {}),
    client: {
      id: "cli-settings",
      name: "jihn-cli",
      version: "1.0.0",
      capabilities: ["settings.read", "settings.write"],
    },
  });

  try {
    return await task(client);
  } finally {
    await client.close();
  }
}

export async function runSettingsCliCommand(
  args: string[],
  providedDeps?: Partial<SettingsCommandDeps>,
): Promise<boolean> {
  if (args[0] !== "settings") {
    return false;
  }

  const deps: SettingsCommandDeps = {
    ...defaultDeps(),
    ...providedDeps,
  };

  const subcommand = args[1] ?? "help";
  if (subcommand === "help" || hasFlag(args, ["--help", "-h"])) {
    printSettingsUsage(deps.log);
    return true;
  }

  if (subcommand === "list") {
    const snapshot = await withGatewayClient(deps, async (client) => {
      return await client.request<SettingsSnapshot>("settings.snapshot", {});
    });
    printList(snapshot, deps.log);
    return true;
  }

  if (subcommand === "get") {
    const key = readFlag(args, ["--key"]);
    if (!key) {
      throw new Error("settings get requires --key");
    }
    const snapshot = await withGatewayClient(deps, async (client) => {
      return await client.request<SettingsSnapshot>("settings.snapshot", {});
    });
    const value = pickValue(snapshot, key);
    if (!value) {
      deps.log(`${key} is not set`);
      return true;
    }
    deps.log(`${key}=${value.value}`);
    deps.log(`updated_by=${value.updatedBy}`);
    deps.log(`updated_at=${value.updatedAt}`);
    return true;
  }

  if (subcommand === "set") {
    const key = readFlag(args, ["--key"]);
    const value = readFlag(args, ["--value"]);
    if (!key || value === undefined) {
      throw new Error("settings set requires --key and --value");
    }

    const result = await withGatewayClient(deps, async (client) => {
      return await client.request<SettingsUpdateResult>("settings.update", {
        key,
        value,
      });
    });

    deps.log(`updated ${result.key}=${result.value}`);
    deps.log(`apply_mode=${result.applyMode}`);
    deps.log(`applied=${result.applied ? "yes" : "no"}`);
    deps.log(`updated_at=${result.updatedAt}`);
    return true;
  }

  if (subcommand === "model") {
    const alias = readFlag(args, ["--alias"]);
    const modelId = readFlag(args, ["--id"]);
    if ((alias ? 1 : 0) + (modelId ? 1 : 0) !== 1) {
      throw new Error("settings model requires exactly one of --alias or --id");
    }

    if (alias) {
      const result = await withGatewayClient(deps, async (client) => {
        return await client.request<SettingsUpdateResult>("settings.update", {
          key: "JIHN_LLM_MODEL_ALIAS",
          value: alias,
        });
      });
      deps.log(`active_model_alias=${result.value}`);
      deps.log(`apply_mode=${result.applyMode}`);
      deps.log(`applied=${result.applied ? "yes" : "no"}`);
      deps.log(`updated_at=${result.updatedAt}`);
      return true;
    }

    const results = await withGatewayClient(deps, async (client) => {
      const updatedModel = await client.request<SettingsUpdateResult>("settings.update", {
        key: "ANTHROPIC_MODEL",
        value: modelId,
      });
      const resetAlias = await client.request<SettingsUpdateResult>("settings.update", {
        key: "JIHN_LLM_MODEL_ALIAS",
        value: "default",
      });
      return { updatedModel, resetAlias };
    });
    deps.log(`active_model_id=${results.updatedModel.value}`);
    deps.log(`model_apply_mode=${results.updatedModel.applyMode}`);
    deps.log(`model_applied=${results.updatedModel.applied ? "yes" : "no"}`);
    deps.log(`alias=${results.resetAlias.value}`);
    return true;
  }

  if (subcommand === "keys") {
    const snapshot = await withGatewayClient(deps, async (client) => {
      return await client.request<SettingsSnapshot>("settings.snapshot", {});
    });
    const keys = [...snapshot.definitions.map((item) => item.key)].sort((left, right) =>
      left.localeCompare(right),
    );
    for (const key of keys) {
      deps.log(key);
    }
    return true;
  }

  printSettingsUsage(deps.log);
  return true;
}

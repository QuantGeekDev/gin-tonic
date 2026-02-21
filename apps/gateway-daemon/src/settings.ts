import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface RuntimeSettingDefinition {
  key: string;
  category: "gateway" | "telegram" | "storage" | "llm" | "api";
  description: string;
  validate: (rawValue: string) => string;
  applyMode: "hot" | "restart_required";
}

export interface RuntimeSettingRecord {
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RuntimeSettingsSnapshot {
  settingsFilePath: string;
  generatedAt: string;
  definitions: Array<{
    key: string;
    category: string;
    description: string;
    applyMode: "hot" | "restart_required";
  }>;
  values: RuntimeSettingRecord[];
}

interface SettingsFile {
  version: 1;
  values: Record<string, RuntimeSettingRecord>;
}

function nonEmpty(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("value must be non-empty");
  }
  return normalized;
}

function positiveInteger(value: string): string {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("value must be a positive integer");
  }
  return String(parsed);
}

function enumValue(value: string, allowed: string[]): string {
  const normalized = value.trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`value must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function truthyFlag(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return "true";
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return "false";
  }
  throw new Error("value must be boolean-like (true/false)");
}

function hostname(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("hostname must be non-empty");
  }
  return normalized;
}

function pathValue(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    throw new Error("path must start with '/'");
  }
  return normalized;
}

const DEFINITIONS: RuntimeSettingDefinition[] = [
  {
    key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
    category: "gateway",
    description: "Max websocket requests per client in a rate-limit window",
    validate: positiveInteger,
    applyMode: "hot",
  },
  {
    key: "JIHN_GATEWAY_RATE_LIMIT_WINDOW_MS",
    category: "gateway",
    description: "Rate-limit window duration in milliseconds",
    validate: positiveInteger,
    applyMode: "hot",
  },
  {
    key: "JIHN_GATEWAY_MAX_CONCURRENCY",
    category: "gateway",
    description: "Gateway global queue concurrency",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_GATEWAY_MAIN_LANE_CONCURRENCY",
    category: "gateway",
    description: "Gateway main lane concurrency",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_STORAGE_BACKEND",
    category: "storage",
    description: "Storage backend mode",
    validate: (raw) => enumValue(raw, ["file", "postgres"]),
    applyMode: "restart_required",
  },
  {
    key: "DATABASE_URL",
    category: "storage",
    description: "Postgres connection URL",
    validate: nonEmpty,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_LLM_PROVIDER",
    category: "llm",
    description: "LLM provider id",
    validate: (raw) => enumValue(raw, ["openai", "anthropic"]),
    applyMode: "hot",
  },
  {
    key: "JIHN_LLM_MODEL",
    category: "llm",
    description: "Global LLM model override",
    validate: nonEmpty,
    applyMode: "hot",
  },
  {
    key: "JIHN_LLM_MODEL_ALIAS",
    category: "llm",
    description: "Runtime model alias profile",
    validate: (raw) => enumValue(raw, ["default", "sonnet", "haiku"]),
    applyMode: "hot",
  },
  {
    key: "OPENAI_MODEL",
    category: "llm",
    description: "OpenAI model id",
    validate: nonEmpty,
    applyMode: "hot",
  },
  {
    key: "ANTHROPIC_MODEL",
    category: "llm",
    description: "Anthropic model id",
    validate: nonEmpty,
    applyMode: "hot",
  },
  {
    key: "JIHN_ANTHROPIC_MODEL_SONNET",
    category: "llm",
    description: "Anthropic Sonnet profile model id",
    validate: nonEmpty,
    applyMode: "hot",
  },
  {
    key: "JIHN_ANTHROPIC_MODEL_HAIKU",
    category: "llm",
    description: "Anthropic Haiku profile model id",
    validate: nonEmpty,
    applyMode: "hot",
  },
  {
    key: "JIHN_TELEGRAM_OUTBOX_BACKEND",
    category: "telegram",
    description: "Telegram outbox backend",
    validate: (raw) => enumValue(raw, ["memory", "postgres"]),
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_OUTBOUND_MAX_ATTEMPTS",
    category: "telegram",
    description: "Telegram outbound max attempts",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_OUTBOUND_BASE_DELAY_MS",
    category: "telegram",
    description: "Telegram outbound base retry delay",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_METRICS_ENABLED",
    category: "telegram",
    description: "Enable Telegram metrics HTTP endpoint",
    validate: truthyFlag,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_METRICS_HOST",
    category: "telegram",
    description: "Telegram metrics HTTP host",
    validate: hostname,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_METRICS_PORT",
    category: "telegram",
    description: "Telegram metrics HTTP port",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_TELEGRAM_METRICS_PATH",
    category: "telegram",
    description: "Telegram metrics path",
    validate: pathValue,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_API_RATE_LIMIT_WINDOW_MS",
    category: "api",
    description: "Web API rate-limit window milliseconds",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
  {
    key: "JIHN_API_RATE_LIMIT_MAX_REQUESTS",
    category: "api",
    description: "Web API max requests per rate-limit window",
    validate: positiveInteger,
    applyMode: "restart_required",
  },
];

const DEFINITIONS_BY_KEY = new Map(DEFINITIONS.map((item) => [item.key, item]));

function settingsPathFromEnv(env: NodeJS.ProcessEnv): string {
  return env.JIHN_SETTINGS_FILE?.trim() || `${process.cwd()}/.jihn/runtime-settings.json`;
}

function sortRecords(records: RuntimeSettingRecord[]): RuntimeSettingRecord[] {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

export class RuntimeSettingsService {
  private readonly settingsFilePath: string;

  public constructor(env: NodeJS.ProcessEnv = process.env) {
    this.settingsFilePath = settingsPathFromEnv(env);
  }

  public async snapshot(currentEnv: NodeJS.ProcessEnv = process.env): Promise<RuntimeSettingsSnapshot> {
    const state = await this.readState();

    const values = new Map<string, RuntimeSettingRecord>();
    for (const definition of DEFINITIONS) {
      const fromFile = state.values[definition.key];
      if (fromFile !== undefined) {
        values.set(definition.key, fromFile);
        continue;
      }
      const fromEnv = currentEnv[definition.key];
      if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
        values.set(definition.key, {
          key: definition.key,
          value: fromEnv.trim(),
          updatedAt: new Date(0).toISOString(),
          updatedBy: "env",
        });
      }
    }

    return {
      settingsFilePath: this.settingsFilePath,
      generatedAt: new Date().toISOString(),
      definitions: DEFINITIONS.map((definition) => ({
        key: definition.key,
        category: definition.category,
        description: definition.description,
        applyMode: definition.applyMode,
      })),
      values: sortRecords([...values.values()]),
    };
  }

  public async update(params: {
    key: string;
    value: string;
    updatedBy: string;
    currentEnv?: NodeJS.ProcessEnv;
  }): Promise<{
    key: string;
    value: string;
    applyMode: "hot" | "restart_required";
    applied: boolean;
    updatedAt: string;
  }> {
    const key = params.key.trim();
    const definition = DEFINITIONS_BY_KEY.get(key);
    if (!definition) {
      throw new Error(`unsupported setting key: ${key}`);
    }

    const normalizedValue = definition.validate(params.value);
    const nowIso = new Date().toISOString();
    const state = await this.readState();
    state.values[key] = {
      key,
      value: normalizedValue,
      updatedAt: nowIso,
      updatedBy: params.updatedBy.trim() || "unknown",
    };
    await this.writeState(state);

    const targetEnv = params.currentEnv ?? process.env;
    targetEnv[key] = normalizedValue;

    return {
      key,
      value: normalizedValue,
      applyMode: definition.applyMode,
      applied: definition.applyMode === "hot",
      updatedAt: nowIso,
    };
  }

  public async loadIntoEnv(targetEnv: NodeJS.ProcessEnv = process.env): Promise<void> {
    const state = await this.readState();
    for (const definition of DEFINITIONS) {
      const existing = state.values[definition.key];
      if (existing) {
        targetEnv[definition.key] = existing.value;
      }
    }
  }

  private async readState(): Promise<SettingsFile> {
    try {
      const raw = await readFile(this.settingsFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SettingsFile>;
      if (parsed.version !== 1 || typeof parsed.values !== "object" || parsed.values === null) {
        return { version: 1, values: {} };
      }
      return {
        version: 1,
        values: parsed.values as Record<string, RuntimeSettingRecord>,
      };
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (isMissing) {
        return { version: 1, values: {} };
      }
      throw error;
    }
  }

  private async writeState(state: SettingsFile): Promise<void> {
    await mkdir(dirname(this.settingsFilePath), { recursive: true });
    const tempPath = `${this.settingsFilePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.settingsFilePath);
  }
}

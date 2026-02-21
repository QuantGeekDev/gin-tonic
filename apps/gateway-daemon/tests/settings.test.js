import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeSettingsService } from "../dist/settings.js";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempEnv() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-settings-test-"));
  tempDirs.push(dir);
  return {
    dir,
    env: {
      JIHN_SETTINGS_FILE: join(dir, "runtime-settings.json"),
    },
  };
}

describe("RuntimeSettingsService", () => {
  it("persists and loads allowlisted settings", async () => {
    const { env } = await tempEnv();
    const service = new RuntimeSettingsService(env);

    const first = await service.update({
      key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
      value: "200",
      updatedBy: "test-client",
      currentEnv: env,
    });

    expect(first.applyMode).toBe("hot");
    expect(env.JIHN_GATEWAY_RATE_LIMIT_REQUESTS).toBe("200");

    const snapshot = await service.snapshot(env);
    expect(snapshot.values.some((item) => item.key === "JIHN_GATEWAY_RATE_LIMIT_REQUESTS")).toBe(true);

    const freshEnv = {
      JIHN_SETTINGS_FILE: env.JIHN_SETTINGS_FILE,
    };
    const second = new RuntimeSettingsService(freshEnv);
    await second.loadIntoEnv(freshEnv);
    expect(freshEnv.JIHN_GATEWAY_RATE_LIMIT_REQUESTS).toBe("200");
  });

  it("rejects unsupported setting keys and invalid values", async () => {
    const { env } = await tempEnv();
    const service = new RuntimeSettingsService(env);

    await expect(
      service.update({
        key: "UNSAFE_KEY",
        value: "x",
        updatedBy: "test-client",
        currentEnv: env,
      }),
    ).rejects.toThrow("unsupported setting key");

    await expect(
      service.update({
        key: "JIHN_GATEWAY_RATE_LIMIT_REQUESTS",
        value: "0",
        updatedBy: "test-client",
        currentEnv: env,
      }),
    ).rejects.toThrow("positive integer");
  });

  it("supports hot LLM alias/profile settings", async () => {
    const { env } = await tempEnv();
    const service = new RuntimeSettingsService(env);

    const alias = await service.update({
      key: "JIHN_LLM_MODEL_ALIAS",
      value: "haiku",
      updatedBy: "test-client",
      currentEnv: env,
    });
    expect(alias.applyMode).toBe("hot");
    expect(alias.applied).toBe(true);
    expect(env.JIHN_LLM_MODEL_ALIAS).toBe("haiku");

    const profile = await service.update({
      key: "JIHN_ANTHROPIC_MODEL_HAIKU",
      value: "claude-3-5-haiku-latest",
      updatedBy: "test-client",
      currentEnv: env,
    });
    expect(profile.applyMode).toBe("hot");
    expect(env.JIHN_ANTHROPIC_MODEL_HAIKU).toBe("claude-3-5-haiku-latest");
  });
});

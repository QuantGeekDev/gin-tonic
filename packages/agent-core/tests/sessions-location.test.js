import { afterEach, describe, expect, it } from "@jest/globals";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_SESSIONS_DIR,
  resolveSessionsDirectory,
  SessionStore,
} from "../dist/index.js";

const ORIGINAL_SESSIONS_ENV = process.env.JIHN_SESSIONS_DIR;

afterEach(() => {
  if (ORIGINAL_SESSIONS_ENV === undefined) {
    delete process.env.JIHN_SESSIONS_DIR;
  } else {
    process.env.JIHN_SESSIONS_DIR = ORIGINAL_SESSIONS_ENV;
  }
});

describe("session directory resolution", () => {
  it("uses ~/.jihn/sessions by default", () => {
    delete process.env.JIHN_SESSIONS_DIR;
    expect(DEFAULT_SESSIONS_DIR).toBe(resolve(homedir(), ".jihn", "sessions"));
    expect(resolveSessionsDirectory()).toBe(DEFAULT_SESSIONS_DIR);
  });

  it("supports env override", () => {
    process.env.JIHN_SESSIONS_DIR = "./tmp/sessions";
    expect(resolveSessionsDirectory()).toBe(resolve("./tmp/sessions"));
  });

  it("session store resolves JSONL file paths", () => {
    const store = new SessionStore("/tmp/jihn-sessions");
    expect(store.resolveSessionDirectoryPath("agent:main")).toBe(
      "/tmp/jihn-sessions/agent_main",
    );
    expect(store.resolveSessionManifestPath("agent:main")).toBe(
      "/tmp/jihn-sessions/agent_main/CURRENT.json",
    );
  });
});

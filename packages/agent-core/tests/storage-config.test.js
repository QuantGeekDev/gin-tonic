import { describe, expect, it } from "@jest/globals";

import {
  createStorageRuntime,
  resolveStorageBackend,
} from "../dist/index.js";

describe("storage config", () => {
  it("defaults to file backend", () => {
    expect(resolveStorageBackend({})).toBe("file");
  });

  it("parses postgres backend", () => {
    expect(resolveStorageBackend({ JIHN_STORAGE_BACKEND: "postgres" })).toBe("postgres");
  });

  it("creates file storage runtime without database url", () => {
    const runtime = createStorageRuntime({
      env: {},
      defaultMcpStorePath: "/tmp/mcp-servers.json",
    });

    expect(runtime.backend).toBe("file");
    expect(runtime.idempotencyStore).toBeUndefined();
    expect(runtime.lockManager).toBeUndefined();
  });
});

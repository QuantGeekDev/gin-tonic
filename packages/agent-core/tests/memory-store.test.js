import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-memory-store-"));
  tempDirs.push(dir);
  return dir;
}

describe("MemoryStore", () => {
  it("saves memory records to file-backed store", async () => {
    const dir = await createTempDir();
    const store = new MemoryStore(dir);

    const saved = await store.saveMemory({
      text: "User likes concise answers",
      namespace: "main:alex",
      tags: ["preference", "style"],
    });

    expect(saved.id).toMatch(/^mem_/);
    expect(saved.namespace).toBe("main:alex");
    expect(saved.tags).toEqual(["preference", "style"]);
  });

  it("searches memory by lexical relevance and namespace", async () => {
    const dir = await createTempDir();
    const store = new MemoryStore(dir);

    await store.saveMemory({
      text: "User prefers TypeScript and concise output",
      namespace: "main:alex",
      tags: ["typescript", "preference"],
    });
    await store.saveMemory({
      text: "User loves Python data science",
      namespace: "main:alex",
      tags: ["python"],
    });
    await store.saveMemory({
      text: "Different namespace entry",
      namespace: "main:other",
      tags: ["typescript"],
    });

    const results = await store.searchMemory({
      query: "typescript concise",
      namespace: "main:alex",
      limit: 5,
    });

    expect(results.length).toBe(1);
    expect(results[0].text).toContain("TypeScript");
    expect(results[0].namespace).toBe("main:alex");
  });
});


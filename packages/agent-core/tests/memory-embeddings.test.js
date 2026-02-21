import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore, runMemoryIndexingJob } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-memory-embeddings-"));
  tempDirs.push(dir);
  let calls = 0;
  const provider = {
    id: "fake",
    async embed(text) {
      calls += 1;
      const base = text.toLowerCase().includes("typescript") ? 1 : 0;
      return [base, text.length % 10, 1];
    },
  };
  return {
    store: new MemoryStore(dir, { embeddingProvider: provider }),
    getCalls: () => calls,
  };
}

describe("memory embeddings", () => {
  it("searches with hybrid lexical + semantic scoring", async () => {
    const { store } = await createStore();
    await store.saveMemory({
      namespace: "global",
      text: "User likes TypeScript and strict typing.",
      tags: ["prefs"],
    });
    await store.saveMemory({
      namespace: "global",
      text: "User enjoys cooking recipes.",
      tags: ["hobby"],
    });

    const results = await store.searchMemory({
      query: "typescript style",
      namespace: "global",
      limit: 2,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((item) => item.text.includes("TypeScript"))).toBe(true);
  });

  it("backfills missing embeddings through indexing job", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jihn-memory-embeddings-backfill-"));
    tempDirs.push(dir);
    const storeWithoutEmbeddings = new MemoryStore(dir);
    await storeWithoutEmbeddings.saveMemory({
      namespace: "global",
      text: "first memory item",
    });
    await storeWithoutEmbeddings.saveMemory({
      namespace: "global",
      text: "second memory item",
    });
    let calls = 0;
    const store = new MemoryStore(dir, {
      embeddingProvider: {
        id: "fake",
        async embed(text) {
          calls += 1;
          return [text.length % 10, 1, 1];
        },
      },
    });

    const firstRun = await runMemoryIndexingJob(store, { limit: 10 });
    const secondRun = await runMemoryIndexingJob(store, { limit: 10 });

    expect(firstRun.indexed).toBe(2);
    expect(secondRun.indexed).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

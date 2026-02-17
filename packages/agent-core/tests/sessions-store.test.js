import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "../dist/index.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createTempSessionsDir() {
  const dir = await mkdtemp(join(tmpdir(), "jihn-sessions-"));
  tempDirs.push(dir);
  return dir;
}

describe("SessionStore", () => {
  it("returns empty list for missing session files", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);

    await expect(store.load("agent:main")).resolves.toEqual([]);
  });

  it("loads JSONL and skips empty/malformed lines", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    await store.ensureSessionsDirectory();
    const sessionDirectory = store.resolveSessionDirectoryPath("agent:main");
    await mkdir(sessionDirectory, { recursive: true });
    const manifestPath = store.resolveSessionManifestPath("agent:main");
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, activeFile: "v000001.jsonl" })}\n`);
    await writeFile(
      join(sessionDirectory, "v000001.jsonl"),
      [
        "",
        "not-json",
        JSON.stringify({ role: "user", content: "hello" }),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "hi" }] }),
        JSON.stringify({ nope: true }),
        "",
      ].join("\n"),
      "utf8",
    );

    const messages = await store.load("agent:main");
    expect(messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("loads structured content blocks exactly as stored", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    await store.ensureSessionsDirectory();
    const sessionDirectory = store.resolveSessionDirectoryPath("agent:main");
    await mkdir(sessionDirectory, { recursive: true });
    const manifestPath = store.resolveSessionManifestPath("agent:main");
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, activeFile: "v000001.jsonl" })}\n`);
    await writeFile(
      join(sessionDirectory, "v000001.jsonl"),
      [
        JSON.stringify({
          role: "assistant",
          content: [
            { type: "text", text: "I will call a tool" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "calculate",
              input: { expression: "2 + 2" },
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "4" }],
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(store.load("agent:main")).resolves.toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will call a tool" },
          { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "2 + 2" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "4" }],
      },
    ]);
  });

  it("ignores JSON values that are valid JSON but invalid message shapes", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    await store.ensureSessionsDirectory();
    const sessionDirectory = store.resolveSessionDirectoryPath("agent:main");
    await mkdir(sessionDirectory, { recursive: true });
    const manifestPath = store.resolveSessionManifestPath("agent:main");
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, activeFile: "v000001.jsonl" })}\n`);
    await writeFile(
      join(sessionDirectory, "v000001.jsonl"),
      [
        JSON.stringify(["array-not-message"]),
        JSON.stringify({ role: "system", content: "bad-role" }),
        JSON.stringify({ role: "assistant", content: 42 }),
        JSON.stringify({ role: "assistant", content: "ok" }),
      ].join("\n"),
      "utf8",
    );

    await expect(store.load("agent:main")).resolves.toEqual([
      { role: "assistant", content: "ok" },
    ]);
  });

  it("appends one JSON object per line with trailing newline", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main";

    await store.append(sessionKey, { role: "user", content: "first" });
    await store.append(sessionKey, { role: "assistant", content: "second" });

    const sessionDirectory = store.resolveSessionDirectoryPath(sessionKey);
    const fileContent = await readFile(join(sessionDirectory, "v000001.jsonl"), "utf8");
    expect(fileContent.endsWith("\n")).toBe(true);
    const lines = fileContent.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ role: "user", content: "first" });
    expect(JSON.parse(lines[1])).toEqual({ role: "assistant", content: "second" });
  });

  it("appends as exact JSONL line format for structured content", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main";
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    };

    await store.append(sessionKey, message);
    const sessionDirectory = store.resolveSessionDirectoryPath(sessionKey);
    const fileContent = await readFile(join(sessionDirectory, "v000001.jsonl"), "utf8");
    expect(fileContent).toBe(`${JSON.stringify(message)}\n`);
  });

  it("saves complete transcripts in JSONL line order", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main";
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "second" }] },
    ];

    await store.save(sessionKey, messages);

    const sessionDirectory = store.resolveSessionDirectoryPath(sessionKey);
    const fileContent = await readFile(join(sessionDirectory, "v000002.jsonl"), "utf8");
    const lines = fileContent.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(JSON.stringify(messages[0]));
    expect(lines[1]).toBe(JSON.stringify(messages[1]));
    await expect(store.load(sessionKey)).resolves.toEqual(messages);
  });

  it("save overwrites prior content instead of appending", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main";

    await store.append(sessionKey, { role: "user", content: "old" });
    await store.save(sessionKey, [{ role: "assistant", content: "new" }]);

    await expect(store.load(sessionKey)).resolves.toEqual([
      { role: "assistant", content: "new" },
    ]);

    const sessionDirectory = store.resolveSessionDirectoryPath(sessionKey);
    const files = await readdir(sessionDirectory);
    expect(files).toEqual(expect.arrayContaining(["v000001.jsonl", "v000002.jsonl", "CURRENT.json"]));
  });

  it("save keeps previous version immutable and switches CURRENT pointer", async () => {
    const dir = await createTempSessionsDir();
    const store = new SessionStore(dir);
    const sessionKey = "agent:main";

    await store.append(sessionKey, { role: "user", content: "v1-message" });
    await store.save(sessionKey, [{ role: "assistant", content: "v2-message" }]);

    const sessionDirectory = store.resolveSessionDirectoryPath(sessionKey);
    const v1 = await readFile(join(sessionDirectory, "v000001.jsonl"), "utf8");
    const v2 = await readFile(join(sessionDirectory, "v000002.jsonl"), "utf8");
    const current = await readFile(join(sessionDirectory, "CURRENT.json"), "utf8");

    expect(v1).toBe(`${JSON.stringify({ role: "user", content: "v1-message" })}\n`);
    expect(v2).toBe(`${JSON.stringify({ role: "assistant", content: "v2-message" })}\n`);
    expect(JSON.parse(current)).toEqual({ version: 2, activeFile: "v000002.jsonl" });
  });
});

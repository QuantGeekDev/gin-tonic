import { describe, expect, it } from "@jest/globals";

import { createSharedToolRuntime } from "../dist/runtime/tools.js";

describe("shared web tools", () => {
  it("registers web_search and web_fetch tool definitions", () => {
    const runtime = createSharedToolRuntime({
      webSearchClient: {
        async search() {
          return [];
        },
        async fetchPage() {
          return {
            url: "https://example.com",
            title: "Example",
            status: 200,
            contentType: "text/html",
            content: "Example",
            truncated: false,
          };
        },
      },
    });
    const names = runtime.definitions.map((item) => item.name);
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  it("executes web_search with mocked client and default limit", async () => {
    const calls = [];
    const runtime = createSharedToolRuntime({
      webSearchClient: {
        async search(params) {
          calls.push(params);
          return [
            {
              title: "Example Domain",
              url: "https://example.com",
              snippet: "Example snippet",
              source: "duckduckgo-lite",
            },
          ];
        },
        async fetchPage() {
          return {
            url: "https://example.com",
            title: "Example",
            status: 200,
            contentType: "text/html",
            content: "Example",
            truncated: false,
          };
        },
      },
    });

    const raw = await runtime.execute("web_search", { query: "example domain" });
    const payload = JSON.parse(raw);

    expect(calls).toEqual([{ query: "example domain", limit: 5 }]);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(1);
    expect(payload.results[0].url).toBe("https://example.com");
  });

  it("executes web_fetch with mocked client and maxChars override", async () => {
    const calls = [];
    const runtime = createSharedToolRuntime({
      webSearchClient: {
        async search() {
          return [];
        },
        async fetchPage(params) {
          calls.push(params);
          return {
            url: params.url,
            title: "Fetched page",
            status: 200,
            contentType: "text/html",
            content: "hello world",
            truncated: false,
          };
        },
      },
    });

    const raw = await runtime.execute("web_fetch", {
      url: "https://example.com/page",
      maxChars: 500,
    });
    const payload = JSON.parse(raw);

    expect(calls).toEqual([{ url: "https://example.com/page", maxChars: 500 }]);
    expect(payload.ok).toBe(true);
    expect(payload.result.title).toBe("Fetched page");
  });
});


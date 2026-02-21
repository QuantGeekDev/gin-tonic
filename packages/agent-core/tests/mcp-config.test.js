import { describe, expect, it } from "@jest/globals";

import { parseMcpServersFromEnv } from "../dist/index.js";

describe("parseMcpServersFromEnv", () => {
  it("parses valid server entries", () => {
    const servers = parseMcpServersFromEnv(
      JSON.stringify([
        {
          id: "Research API",
          url: "https://mcp.example.com/mcp",
          enabled: true,
          headers: {
            Authorization: "Bearer token",
          },
          requestTimeoutMs: 8000,
        },
      ]),
    );

    expect(servers).toEqual([
      {
        id: "research-api",
        url: "https://mcp.example.com/mcp",
        enabled: true,
        headers: {
          Authorization: "Bearer token",
        },
        requestTimeoutMs: 8000,
      },
    ]);
  });

  it("returns empty list for invalid env payload", () => {
    expect(parseMcpServersFromEnv("not json")).toEqual([]);
    expect(parseMcpServersFromEnv("{}")).toEqual([]);
    expect(parseMcpServersFromEnv(undefined)).toEqual([]);
  });
});

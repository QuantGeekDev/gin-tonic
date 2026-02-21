import { describe, expect, it } from "@jest/globals";

import { resolveAgentRoute } from "../dist/index.js";

describe("resolveAgentRoute", () => {
  it("routes /research prefix to research agent", () => {
    const resolved = resolveAgentRoute({
      text: "/research Compare top cloud data warehouses",
      defaultAgentId: "main",
    });

    expect(resolved).toEqual({
      kind: "research",
      agentId: "research",
      text: "Compare top cloud data warehouses",
    });
  });

  it("routes /agent:<name> to named agent", () => {
    const resolved = resolveAgentRoute({
      text: "/agent:ops summarize last deploy alerts",
      defaultAgentId: "main",
    });

    expect(resolved).toEqual({
      kind: "named",
      agentId: "ops",
      text: "summarize last deploy alerts",
    });
  });

  it("falls back to default agent for invalid directives", () => {
    const resolved = resolveAgentRoute({
      text: "/agent: keep current behavior",
      defaultAgentId: "main",
    });

    expect(resolved).toEqual({
      kind: "default",
      agentId: "main",
      text: "/agent: keep current behavior",
    });
  });
});

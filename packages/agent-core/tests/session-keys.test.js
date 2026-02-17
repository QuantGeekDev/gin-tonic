import { describe, expect, it } from "@jest/globals";

import { buildSessionKey, SESSION_SCOPES } from "../dist/index.js";

describe("buildSessionKey", () => {
  it("builds stable key format", () => {
    const key = buildSessionKey({
      agentId: "main",
      scope: "peer",
      peerId: "alex",
      channelId: "web",
    });

    expect(key).toBe("agent:main:scope:peer:peer:alex:channel:web");
  });

  it("is deterministic for same input", () => {
    const input = {
      agentId: "main",
      scope: "channel-peer",
      peerId: "alex",
      channelId: "cli",
    };
    expect(buildSessionKey(input)).toBe(buildSessionKey(input));
  });

  it("sanitizes dangerous characters", () => {
    const key = buildSessionKey({
      agentId: "agent/main:prod",
      scope: "global",
      peerId: "john doe\\admin",
      channelId: "web / internal",
    });

    expect(key).toBe(
      "agent:agent_main_prod:scope:global:peer:john_doe_admin:channel:web_internal",
    );
  });

  it("exports supported scopes", () => {
    expect(SESSION_SCOPES).toEqual(["channel-peer", "peer", "global"]);
  });
});

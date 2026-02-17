export const SESSION_SCOPES = ["channel-peer", "peer", "global"] as const;

export type SessionScope = (typeof SESSION_SCOPES)[number];

export interface SessionKeyInput {
  agentId: string;
  scope: SessionScope;
  channelId: string;
  peerId: string;
}

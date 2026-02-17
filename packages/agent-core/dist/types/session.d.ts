export declare const SESSION_SCOPES: readonly ["channel-peer", "peer", "global"];
export type SessionScope = (typeof SESSION_SCOPES)[number];
export interface SessionKeyInput {
    agentId: string;
    scope: SessionScope;
    channelId: string;
    peerId: string;
}
//# sourceMappingURL=session.d.ts.map
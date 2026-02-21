export type AgentRouteKind = "default" | "research" | "named";
export interface ResolveAgentRouteInput {
    text: string;
    defaultAgentId?: string;
}
export interface ResolveAgentRouteResult {
    kind: AgentRouteKind;
    agentId: string;
    text: string;
}
export declare function resolveAgentRoute(input: ResolveAgentRouteInput): ResolveAgentRouteResult;
//# sourceMappingURL=router.d.ts.map
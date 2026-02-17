export interface Message {
    role: "user" | "assistant";
    content: ContentBlock[] | string;
}
export interface TextBlock {
    type: "text";
    text: string;
}
export interface ToolUseBlock {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}
export interface ToolResultBlock {
    type: "tool_result";
    tool_use_id: string;
    content: string;
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
//# sourceMappingURL=message.d.ts.map
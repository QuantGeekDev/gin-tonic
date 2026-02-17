export type JsonSchema = Readonly<Record<string, unknown>>;
export interface ToolDefinition<ToolName extends string = string> {
    name: ToolName;
    description: string;
    inputSchema: JsonSchema;
    input_schema?: JsonSchema;
}
//# sourceMappingURL=tools.d.ts.map
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDefinition<ToolName extends string = string> {
  name: ToolName;
  description: string;
  inputSchema: JsonSchema;
  /**
   * Backward-compatibility alias for snake_case consumers.
   */
  input_schema?: JsonSchema;
}

export type InputParser<ToolInput> = (rawInput: unknown) => ToolInput;

export type ToolHandler<ToolInput, ToolOutput = string> = (
  input: ToolInput,
) => Promise<ToolOutput> | ToolOutput;

export interface Tool<
  ToolInput = unknown,
  ToolOutput = string,
  ToolName extends string = string,
> {
  definition: ToolDefinition<ToolName>;
  parseInput: InputParser<ToolInput>;
  handler: ToolHandler<ToolInput, ToolOutput>;
}

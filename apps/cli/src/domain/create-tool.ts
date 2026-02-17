import type {
  InputParser,
  JsonSchema,
  Tool,
  ToolDefinition,
  ToolHandler,
} from "./tool.js";

interface ToolDefinitionConfig<TName extends string> {
  name: TName;
  description: string;
  inputSchema: JsonSchema;
}

interface ToolImplementation<TInput, TOutput> {
  parseInput: (rawInput: unknown) => TInput;
  handler: ToolHandler<TInput, TOutput>;
}

/**
 * Normalize definition shape and maintain backward-compatible aliases.
 * Use this in custom tools to keep definition authoring consistent.
 */
export function createToolDefinition<TName extends string>(
  config: ToolDefinitionConfig<TName>,
): ToolDefinition<TName> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    input_schema: config.inputSchema,
  };
}

/**
 * Create a full tool from a reusable definition and implementation.
 * This supports sharing definitions between runtime and docs/registration.
 */
export function createToolFromDefinition<
  TInput,
  TOutput = string,
  TName extends string = string,
>(
  definition: ToolDefinition<TName>,
  implementation: ToolImplementation<TInput, TOutput>,
): Tool<TInput, TOutput, TName> {
  return {
    definition,
    parseInput: implementation.parseInput,
    handler: implementation.handler,
  };
}

/**
 * Convenience all-in-one helper for simple tools.
 */
export function createTool<TInput, TOutput = string, TName extends string = string>(
  config: ToolDefinitionConfig<TName> & {
    parseInput: InputParser<TInput>;
    handler: ToolHandler<TInput, TOutput>;
  },
): Tool<TInput, TOutput, TName> {
  const definition = createToolDefinition({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
  });

  return createToolFromDefinition(definition, {
    parseInput: config.parseInput,
    handler: config.handler,
  });
}

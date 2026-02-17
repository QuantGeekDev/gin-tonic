import {
  ToolAlreadyRegisteredError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolResultError,
} from "../domain/errors.js";
import type { Tool, ToolDefinition } from "../domain/tool.js";

interface RegisteredTool {
  definition: ToolDefinition;
  run(rawInput: unknown): Promise<unknown>;
}

class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  public register<ToolInput, ToolOutput>(
    tool: Tool<ToolInput, ToolOutput, string>,
  ): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new ToolAlreadyRegisteredError(name);
    }

    const registered: RegisteredTool = {
      definition: tool.definition,
      async run(rawInput: unknown): Promise<unknown> {
        let parsedInput: ToolInput;
        try {
          parsedInput = tool.parseInput(rawInput);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new ToolInputValidationError(name, message);
        }

        try {
          const result = await tool.handler(parsedInput);
          if (result === null || result === undefined) {
            throw new ToolResultError(name);
          }
          return result;
        } catch (error) {
          if (error instanceof ToolResultError) {
            throw error;
          }
          throw new ToolExecutionError(name, error);
        }
      },
    };

    this.tools.set(name, registered);
  }

  public getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  public async execute<ToolOutput = unknown>(
    name: string,
    rawInput: unknown,
  ): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    const result = await tool.run(rawInput);
    return result as ToolOutput;
  }
}

export default ToolRegistry;

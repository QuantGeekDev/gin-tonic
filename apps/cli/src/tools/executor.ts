import type ToolRegistry from "./registry.js";

export interface ExecuteToolRequest {
  toolName: string;
  input: unknown;
}

export class ToolExecutor {
  private readonly registry: ToolRegistry;

  public constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  public async run<ToolOutput = unknown>(
    request: ExecuteToolRequest,
  ): Promise<ToolOutput> {
    return this.registry.execute<ToolOutput>(request.toolName, request.input);
  }
}

import { createSharedToolRuntime, type ToolDefinition } from "@jihn/agent-core";

interface ToolRegistryLike {
  getDefinitions(): ToolDefinition[];
  execute<ToolOutput = unknown>(name: string, rawInput: unknown): Promise<ToolOutput>;
}

export function createToolRegistry(): ToolRegistryLike {
  const runtime = createSharedToolRuntime();
  return {
    getDefinitions(): ToolDefinition[] {
      return runtime.definitions;
    },
    async execute<ToolOutput = unknown>(
      name: string,
      rawInput: unknown,
    ): Promise<ToolOutput> {
      const normalizedInput =
        typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      return (await runtime.execute(name, normalizedInput)) as ToolOutput;
    },
  };
}

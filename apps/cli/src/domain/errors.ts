export class ToolAlreadyRegisteredError extends Error {
  public constructor(toolName: string) {
    super(`Tool '${toolName}' is already registered.`);
    this.name = "ToolAlreadyRegisteredError";
  }
}

export class ToolNotFoundError extends Error {
  public constructor(toolName: string) {
    super(`Tool '${toolName}' was not found in the registry.`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolInputValidationError extends Error {
  public constructor(toolName: string, message: string) {
    super(`Tool '${toolName}' received invalid input: ${message}`);
    this.name = "ToolInputValidationError";
  }
}

export class ToolExecutionError extends Error {
  public constructor(toolName: string, reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason);
    super(`Tool '${toolName}' failed during execution: ${message}`);
    this.name = "ToolExecutionError";
  }
}

export class ToolResultError extends Error {
  public constructor(toolName: string) {
    super(`Tool '${toolName}' returned null or undefined.`);
    this.name = "ToolResultError";
  }
}

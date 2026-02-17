import { CalculateTool } from "../custom_tools/calculate.tool.js";
import { CurrentTimeTool } from "../custom_tools/current_time.tool.js";
import ToolRegistry from "../tools/registry.js";

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(CurrentTimeTool);
  registry.register(CalculateTool);
  return registry;
}

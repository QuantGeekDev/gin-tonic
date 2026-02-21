import type { ToolDefinition } from "../tools.js";

export const CURRENT_TIME_TOOL: ToolDefinition = {
  name: "current_time",
  description: "Return the current UTC time in ISO-8601 format.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
};

export const CALCULATE_TOOL: ToolDefinition = {
  name: "calculate",
  description:
    "Evaluate a basic arithmetic expression with numbers, spaces, parentheses, and + - * / operators.",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string" },
    },
    required: ["expression"],
    additionalProperties: false,
  },
};

export const SAVE_MEMORY_TOOL: ToolDefinition = {
  name: "save_memory",
  description:
    "Persist a durable memory note for future turns. Use for user preferences, facts, and long-term context.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      namespace: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

export const MEMORY_SEARCH_TOOL: ToolDefinition = {
  name: "memory_search",
  description:
    "Search durable memories by query. Returns highest relevance matches with score and metadata.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      namespace: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const WEB_SEARCH_TOOL: ToolDefinition = {
  name: "web_search",
  description:
    "Search the public web without API keys and return concise result snippets with URLs.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 8 },
      site: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: "web_fetch",
  description:
    "Fetch a public web page URL and return cleaned text content for grounding and citation.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      maxChars: { type: "integer", minimum: 200, maximum: 20_000 },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

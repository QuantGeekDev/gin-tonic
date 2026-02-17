import { createToolDefinition, createToolFromDefinition } from "../domain/create-tool.js";

interface CalculateInput {
  expression: string;
}

function evaluateExpression(expression: string): number {
  let cursor = 0;

  function skipWhitespace(): void {
    while (cursor < expression.length && /\s/.test(expression[cursor] ?? "")) {
      cursor += 1;
    }
  }

  function parseNumber(): number {
    skipWhitespace();
    const start = cursor;

    while (cursor < expression.length && /[0-9.]/.test(expression[cursor] ?? "")) {
      cursor += 1;
    }

    const value = expression.slice(start, cursor);
    if (value.length === 0) {
      throw new Error("Expected a number.");
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid numeric value.");
    }

    return parsed;
  }

  function parseFactor(): number {
    skipWhitespace();
    const next = expression[cursor];
    if (next === "(") {
      cursor += 1;
      const nested = parseSum();
      skipWhitespace();
      if (expression[cursor] !== ")") {
        throw new Error("Missing closing parenthesis.");
      }
      cursor += 1;
      return nested;
    }

    if (next === "-") {
      cursor += 1;
      return -parseFactor();
    }

    return parseNumber();
  }

  function parseProduct(): number {
    let value = parseFactor();
    while (true) {
      skipWhitespace();
      const operator = expression[cursor];
      if (operator !== "*" && operator !== "/") {
        return value;
      }

      cursor += 1;
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
  }

  function parseSum(): number {
    let value = parseProduct();
    while (true) {
      skipWhitespace();
      const operator = expression[cursor];
      if (operator !== "+" && operator !== "-") {
        return value;
      }

      cursor += 1;
      const right = parseProduct();
      value = operator === "+" ? value + right : value - right;
    }
  }

  const result = parseSum();
  skipWhitespace();
  if (cursor !== expression.length) {
    throw new Error("Unexpected characters in expression.");
  }

  if (!Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number.");
  }

  return result;
}

const CalculateToolDefinition = createToolDefinition({
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
});

export const CalculateTool = createToolFromDefinition<
  CalculateInput,
  string,
  "calculate"
>(CalculateToolDefinition, {
  parseInput(rawInput) {
    if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
      throw new Error("Expected an object with string field 'expression'.");
    }

    const input = rawInput as Record<string, unknown>;
    if (typeof input.expression !== "string") {
      throw new Error("Field 'expression' must be a string.");
    }

    const expression = input.expression.trim();
    if (expression.length === 0) {
      throw new Error("Field 'expression' cannot be empty.");
    }
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      throw new Error("Expression contains unsupported characters.");
    }

    return { expression };
  },
  handler(input) {
    const result = evaluateExpression(input.expression);
    return String(result);
  },
});

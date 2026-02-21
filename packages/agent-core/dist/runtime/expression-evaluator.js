export function evaluateExpression(expression) {
    let cursor = 0;
    function skipWhitespace() {
        while (cursor < expression.length && /\s/.test(expression[cursor] ?? "")) {
            cursor += 1;
        }
    }
    function parseNumber() {
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
    function parseFactor() {
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
    function parseProduct() {
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
    function parseSum() {
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
//# sourceMappingURL=expression-evaluator.js.map
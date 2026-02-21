export function estimateMessageTokens(messages) {
    const roughChars = messages.reduce((total, message) => {
        return total + JSON.stringify(message).length;
    }, 0);
    return Math.max(1, Math.ceil(roughChars / 4));
}
export async function countContextTokens(client, params) {
    if (typeof client.countTokens !== "function") {
        return estimateMessageTokens(params.messages);
    }
    return client.countTokens(params);
}
//# sourceMappingURL=token-counting.js.map
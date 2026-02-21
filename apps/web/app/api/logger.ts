import { createJihnLogger } from "@jihn/agent-core";

export const apiLogger = createJihnLogger({
  name: "jihn-web-api",
});

export function createRequestLogger(route: string, requestId: string) {
  return apiLogger.child({
    route,
    requestId,
  });
}

export function generateRequestId(): string {
  return `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

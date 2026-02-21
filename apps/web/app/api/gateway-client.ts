import { JihnGatewayClient } from "@jihn/gateway-client";

let clientPromise: Promise<JihnGatewayClient> | null = null;

function gatewayUrl(): string {
  return process.env.JIHN_GATEWAY_URL ?? "ws://127.0.0.1:18789/ws";
}

async function initializeClient(): Promise<JihnGatewayClient> {
  const client = new JihnGatewayClient();
  await client.connect({
    url: gatewayUrl(),
    client: {
      id: "web-api",
      name: "jihn-web-api",
      version: "1.0.0",
      capabilities: ["agent.run", "mcp", "memory", "plugins", "settings", "benchmark"],
    },
    ...(process.env.JIHN_GATEWAY_TOKEN !== undefined
      ? { authToken: process.env.JIHN_GATEWAY_TOKEN }
      : {}),
  });
  return client;
}

export async function getGatewayClient(): Promise<JihnGatewayClient> {
  if (clientPromise === null) {
    clientPromise = initializeClient().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return await clientPromise;
}

export async function closeGatewayClient(): Promise<void> {
  if (clientPromise === null) {
    return;
  }
  const client = await clientPromise;
  await client.close();
  clientPromise = null;
}

function registerShutdownHooks(): void {
  let closing = false;
  const handler = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    closeGatewayClient().catch(() => {});
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
registerShutdownHooks();

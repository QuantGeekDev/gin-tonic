import "dotenv/config";
import { createJihnLogger } from "@jihn/agent-core";
import { loadTelegramChannelConfig } from "./config.js";
import { createTelegramAgentRuntime } from "./runtime.js";
import { createTelegramChannelService } from "./telegram/service.js";

const logger = createJihnLogger({ name: "jihn-channel-telegram" });

async function main(): Promise<void> {
  const config = loadTelegramChannelConfig(process.env);
  const runtime = await createTelegramAgentRuntime(config);
  const service = createTelegramChannelService({ config, runtime });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "telegram.shutdown.begin");
    try {
      await service.stop();
      await runtime.close();
      logger.info({ signal }, "telegram.shutdown.complete");
      process.exit(0);
    } catch (error) {
      logger.error(
        { signal, error: error instanceof Error ? error.message : String(error) },
        "telegram.shutdown.failed",
      );
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await service.start();
}

void main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "telegram.fatal");
  process.exit(1);
});

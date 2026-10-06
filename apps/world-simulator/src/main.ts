import { load_config } from "@yuiju/shared/config/load";
import { getEnvironment } from "@yuiju/shared/env/environment";
import { init_logger, logger } from "@yuiju/shared/logger/logger";
import { startWorldSimulator } from "./application";

async function main(): Promise<void> {
  await init_logger({
    app: "world-simulator",
    log_dir: new URL("../logs/", import.meta.url),
    level: getEnvironment() === "production" ? "info" : "debug",
  });
  const config = await load_config();
  const application = await startWorldSimulator(config);

  async function onSignal(): Promise<void> {
    try {
      await application.stop();
    } catch (error) {
      logger.error("世界服务停止失败", { error });
      process.exitCode = 1;
    }
  }
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

main().catch((error: unknown) => {
  console.error("world-simulator 启动失败", error);
  process.exitCode = 1;
});

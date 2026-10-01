import { init_logger, logger } from "@yuiju/shared/logger/logger";

await init_logger({
  app: "world-simulator",
  log_dir: new URL("../logs/", import.meta.url),
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
});

logger.info("日志初始化完成");

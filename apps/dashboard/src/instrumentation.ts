export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { join } = await import("node:path");
    const { getEnvironment } = await import("@yuiju/shared/env/environment");
    const { init_logger, logger } = await import("@yuiju/shared/logger/logger");

    await init_logger({
      app: "dashboard",
      // Next.js 的工作目录是应用目录，构建后仍写入同一个 logs 目录。
      log_dir: join(process.cwd(), "logs"),
      level: getEnvironment() === "production" ? "info" : "debug",
    });

    logger.info("日志初始化完成");
  }
}

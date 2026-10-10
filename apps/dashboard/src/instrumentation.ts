import { getEnvironment } from "@yuiju/shared/env/environment";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 按运行时加载，避免 Edge instrumentation 引入 Node.js 日志依赖。
    const { init_logger } = await import("@yuiju/shared/logger/logger");

    await init_logger({
      app: "dashboard",
      level: getEnvironment() === "production" ? "info" : "debug",
    });
  }
}

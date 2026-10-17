import { getEnvironment } from "@yuiju/shared/utils/environment";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 按运行时加载，避免 Edge instrumentation 引入 Node.js 依赖。
    const { init_logger } = await import("@yuiju/shared/logger/logger");
    const { initializePrompts } = await import("@yuiju/shared/prompt/template");

    await init_logger({
      app: "dashboard",
      level: getEnvironment() === "production" ? "info" : "debug",
    });
    await initializePrompts();
  }
}

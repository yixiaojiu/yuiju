import { getEnvironment } from "@yuiju/shared/utils/environment";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 按运行时加载，避免 Edge instrumentation 引入 Node.js 依赖。
    const { init_logger } = await import("@yuiju/shared/logger/logger");

    await init_logger({
      app: "dashboard",
      level: getEnvironment() === "production" ? "info" : "debug",
    });

    const { load_config } = await import("@yuiju/shared/config/load");
    const config = await load_config();
    if (!config.app!.public_deployment) {
      const { initializePrompts } = await import("@yuiju/shared/prompt/template");
      await initializePrompts();
    }
  }
}

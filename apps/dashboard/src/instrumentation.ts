import { getEnvironment } from "@yuiju/shared/env/environment";
import { init_logger } from "@yuiju/shared/logger/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await init_logger({
      app: "dashboard",
      level: getEnvironment() === "production" ? "info" : "debug",
    });
  }
}

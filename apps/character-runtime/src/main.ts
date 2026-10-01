import { load_config } from "@yuiju/shared/config/load";
import { init_logger, logger } from "@yuiju/shared/logger/logger";
import { Character } from "./character";

async function main() {
  await init_logger({
    app: "character-runtime",
    log_dir: new URL("../logs/", import.meta.url),
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
  });
  const config = await load_config();
  if (!config.characters) return;
  const characters = Object.entries(config.characters).map(
    ([id, character]) => new Character(id, character),
  );
  let stopRequested = false;
  async function startCharacters() {
    for (const character of characters) {
      if (stopRequested) break;
      await character.start();
      logger.info("角色已启动", { characterId: character.id });
    }
  }
  const startup = startCharacters();

  async function stopCharacters() {
    // 等待正在启动的角色完成交接，再关闭资源，不与 start 并发修改连接。
    await Promise.allSettled([startup]);
    const results = await Promise.allSettled(characters.map((character) => character.stop()));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "角色停止失败",
      );
    logger.info("所有角色已停止");
  }

  let shutdown: Promise<void> | undefined;
  const stop = () => {
    stopRequested = true;
    shutdown ??= stopCharacters();
    return shutdown;
  };
  const onSignal = () => {
    void stop().catch((error: unknown) => {
      logger.error("character-runtime 停止失败", { error });
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await startup;
  } catch (error) {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    try {
      await stop();
    } catch (stopError) {
      throw new AggregateError([error, stopError], "角色启动失败，清理资源时也发生错误");
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("character-runtime 启动失败", error);
  process.exitCode = 1;
});

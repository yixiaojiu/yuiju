import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { load_config } from "@yuiju/shared/config/load";
import { closeMongo } from "@yuiju/shared/database/mongo";
import { closeRedis } from "@yuiju/shared/database/redis";
import { init_logger, logger } from "@yuiju/shared/logger/logger";
import { initializePrompts } from "@yuiju/shared/prompt/template";
import { Character } from "./character";
import { startConversationArchive } from "./conversation/archive";

async function main() {
  const { values } = parseArgs({
    options: {
      character: { type: "string" },
      mode: { type: "string", default: "all" },
    },
  });
  const characterId = values.character;
  if (!characterId) {
    throw new Error("请通过 --character 指定角色 ID");
  }
  const mode = values.mode;
  if (mode !== "all" && mode !== "conversation" && mode !== "agent") {
    throw new Error("mode 必须是 all、conversation 或 agent");
  }
  const config = await load_config();
  if (!config.characters || !Object.hasOwn(config.characters, characterId)) {
    throw new Error(`角色未配置：${characterId}`);
  }
  await init_logger({
    app: "character-runtime",
    log_dir: join(fileURLToPath(new URL("../logs/", import.meta.url)), characterId),
    level: "info",
  });
  await initializePrompts();
  const character = new Character(characterId, config.characters[characterId], mode);
  const archive = mode !== "agent" ? startConversationArchive(characterId) : undefined;
  const startup = character.start();

  async function stopRuntime() {
    // 等待正在启动的角色完成交接，再关闭资源，不与 start 并发修改连接。
    await Promise.allSettled([startup]);
    const results = await Promise.allSettled([character.stop()]);
    // 会话停止后再停止归档；只等待在途批次，Redis 中的剩余积压留到下次启动。
    results.push(...(await Promise.allSettled([archive?.stop()])));
    results.push(...(await Promise.allSettled([closeMongo()])));
    closeRedis();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "角色停止失败",
      );
    }
  }

  let shutdown: Promise<void> | undefined;
  const stop = () => {
    shutdown ??= stopRuntime();
    return shutdown;
  };
  const onSignal = async () => {
    try {
      await stop();
    } catch (error) {
      logger.error("character-runtime 停止失败", { error });
      process.exitCode = 1;
    }
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

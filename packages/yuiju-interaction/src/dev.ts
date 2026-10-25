import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { flushAnalyticsEvents } from "@yuiju/shared/analytics/report-event";
import { load_config } from "@yuiju/shared/config/load";
import { closeMongo } from "@yuiju/shared/database/mongo";
import { init_logger, logger } from "@yuiju/shared/logger/logger";
import { initializePrompts } from "@yuiju/shared/prompt/template";
import interaction from "../agent.ts";

/** 独立调试只运行插件场景；世界条件检查与控制权交接仍由正式宿主负责。 */
async function main() {
  const { values } = parseArgs({ options: { character: { type: "string" } } });
  const characterId = values.character;
  if (!characterId) {
    throw new Error("请通过 --character 指定角色 ID");
  }
  const config = await load_config();
  if (!config.characters || !Object.hasOwn(config.characters, characterId)) {
    throw new Error(`角色未配置：${characterId}`);
  }
  await init_logger({
    app: "yuiju-interaction",
    level: "debug",
    log_dir: join(fileURLToPath(new URL("../logs/", import.meta.url)), characterId),
  });
  await initializePrompts(interaction.prompts);

  const controller = new AbortController();
  // 信号只取消场景；等待在途模型和工具退出后，再按顺序释放资源。
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    // 一轮结束只释放场景，下一轮使用全新上下文和默认提示词，不退出调试进程。
    while (!controller.signal.aborted) {
      const scene = interaction.agents[0].create({
        character: { id: characterId, name: config.characters[characterId].name },
      });
      const execution = {
        sessionId: randomUUID(),
        signal: controller.signal,
        ready() {
          logger.info(
            "互动调试入口已就绪，在页面选择「独立调试」并连接，连接目标标签页后点击「进入」",
          );
        },
      };
      try {
        await scene.waitForEntry(undefined, execution);
        logger.info("互动调试开始");
        const result = await scene.run(execution);
        logger.info("互动调试结束", result);
      } finally {
        await scene.dispose();
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
    logger.info("互动调试已停止");
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    try {
      await flushAnalyticsEvents();
    } finally {
      // 模型取消时也会上报埋点，必须等最后一条写入结束后才能关闭连接。
      await closeMongo();
    }
  }
}

main().catch((error: unknown) => {
  console.error("互动调试失败", error);
  process.exitCode = 1;
});

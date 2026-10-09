import type { Config } from "@yuiju/shared/config/schema";
import { closeMongo } from "@yuiju/shared/database/mongo";
import { closeRedis, getRedis } from "@yuiju/shared/database/redis";
import { characterDefinitions } from "./content/characters";
import { places, routes } from "./content/locations";
import { createWorldMap } from "./map";
import { WorldEventQueues } from "./queue";
import { serveWorld } from "./server/server";
import { startWorldSync } from "./sync";
import { World } from "./world";

/** 组装并恢复世界，再启动服务；返回按依赖顺序释放资源的 stop 方法。 */
export async function startWorldSimulator(config: Config) {
  const map = createWorldMap(places, routes);
  const names = new Map(
    Object.entries(config.characters ?? {}).map(([id, character]) => [id, character.name]),
  );
  const definitions = new Map(
    characterDefinitions
      .filter((definition) => names.has(definition.characterId))
      .map((definition) => [definition.characterId, definition]),
  );

  for (const characterId of names.keys()) {
    if (!definitions.has(characterId)) {
      throw new Error(`角色 ${characterId} 缺少世界初始资料，请在 content/characters.ts 声明`);
    }
  }
  for (const definition of definitions.values()) {
    for (const placeId of [definition.initialPlaceId, ...definition.familiarPlaceIds]) {
      if (!map.placesById.has(placeId)) {
        throw new Error(`角色 ${definition.characterId} 引用了未知地点 ${placeId}`);
      }
    }
  }

  const queues = new WorldEventQueues(
    await getRedis(),
    config.database!.redis_url!,
    definitions.keys(),
  );
  const world = new World(map, definitions, names, config.app!.timezone!, queues);
  /** 启动中途失败时，只关闭已经创建的服务入口。 */
  let server: Awaited<ReturnType<typeof serveWorld>> | undefined;
  /** 同时收到多个退出请求时，共用同一次关闭任务。 */
  let shutdown: Promise<void> | undefined;
  let stopSync: (() => Promise<void>) | undefined;

  // 世界恢复完成后再监听请求。
  try {
    await queues.start();
    await world.start();
    stopSync = startWorldSync(world, config);
    server = await serveWorld(world, queues);
  } catch (error) {
    try {
      await closeResources();
    } catch (stopError) {
      throw new AggregateError([error, stopError], "世界服务启动失败，清理资源时也发生错误");
    }
    throw error;
  }

  return {
    /** 停止服务与世界任务，再关闭数据库连接；重复调用共用同一任务。 */
    stop(): Promise<void> {
      shutdown ??= closeResources();
      return shutdown;
    },
  };

  /** 前一阶段失败仍继续释放后续资源，全部处理完再报告清理错误。 */
  async function closeResources(): Promise<void> {
    const failures: unknown[] = [];

    // 先停止请求入口，等待已经进入世界的行动请求结束。
    try {
      await server?.stop();
    } catch (error) {
      failures.push(error);
    }

    try {
      await stopSync?.();
    } catch (error) {
      failures.push(error);
    }

    // 世界停止 tick 与生成，等待在途数据库写入结束。
    try {
      await world.stop();
    } catch (error) {
      failures.push(error);
    }

    // 世界不再产生任务后，停止归档消费者；未完成任务留在 Redis。
    try {
      await queues.stop();
    } catch (error) {
      failures.push(error);
    }

    // 业务不再使用数据库后，最后释放共享连接。
    try {
      await closeMongo();
    } catch (error) {
      failures.push(error);
    }
    closeRedis();

    if (failures.length) {
      throw new AggregateError(failures, "世界服务停止失败");
    }
  }
}

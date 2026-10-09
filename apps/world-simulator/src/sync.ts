import type { Config } from "@yuiju/shared/config/schema";
import type {
  ActivityRecord,
  WorldEnvironmentStatus,
  WorldStatus,
} from "@yuiju/shared/dashboard/types";
import { mongoCollectionName, redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { startSyncTask } from "@yuiju/shared/database/sync";
import { getEnvironment } from "@yuiju/shared/env/environment";
import type { WorldFact } from "./events";
import { loadWorldState, worldRetentionMs } from "./storage";
import type { World } from "./world";

let archiveIndexesCreated = false;

/** 归档消费者调用；沿用其重试语义，远程失败不阻塞世界状态提交。 */
export async function syncWorldFact(fact: ActivityRecord): Promise<void> {
  const collection = (await getMongoDatabase("sync")).collection(
    mongoCollectionName("world_events"),
  );
  if (!archiveIndexesCreated) {
    await collection.createIndex({ eventId: 1 }, { unique: true });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await collection.createIndex({ characterId: 1, occurredAt: -1 });
    archiveIndexesCreated = true;
  }
  const { eventId, characterId, occurredAt, type, activity, description } = fact;
  await collection.replaceOne(
    { eventId },
    {
      eventId,
      characterId,
      occurredAt,
      type,
      activity,
      description,
      expiresAt: new Date(occurredAt + worldRetentionMs),
    },
    { upsert: true },
  );
}

/** 本地展示快照始终刷新；生产环境才向远程同步状态并补齐公开历史。 */
export function startWorldSync(world: World, config: Config) {
  const isProduction = getEnvironment() === "production";
  const stopStatus = startSyncTask("世界状态同步", 5_000, async () => {
    const primary = await getRedis();
    // 从已提交的 Redis 状态生成公开展示数据，名称沿用世界内容定义。
    const state = await loadWorldState();
    if (state === null) {
      throw new Error("世界状态尚未保存，不能同步展示数据");
    }
    const environment: WorldEnvironmentStatus = {
      updatedAt: Date.now(),
      weather: state.weather,
      weatherPeriod: state.weatherPeriod,
      resourceDate: state.resourceDate,
      places: Object.entries(state.places).map(([id, place]) => ({
        id,
        name: world.map.placesById.get(id)!.name,
        isOpen: place.isOpen,
        closed: place.closed,
        resources: Object.entries(place.resources).map(([name, quantity]) => ({ name, quantity })),
      })),
    };
    const environmentKey = `${redisKeyPrefix()}dashboard:world:environment`;
    await primary.set(environmentKey, JSON.stringify(environment), "EX", 7 * 86400);
    for (const characterId of Object.keys(config.characters ?? {})) {
      const result = world.inspect(characterId, { type: "current" });
      if (!result.ok) {
        throw new Error(result.message);
      }
      if (result.value.type !== "current") {
        throw new Error("世界 current 查询返回了其他类型");
      }
      const current = result.value;
      const status: WorldStatus = {
        updatedAt: current.now,
        position: current.position,
        activity: current.activity,
        stamina: current.body.stamina,
        satiety: current.body.satiety,
        money: current.money,
        phoneBattery: current.phoneBattery,
        inventory: current.inventory,
        weather: current.observation.status === "observed" ? current.observation.weather : null,
      };
      const key = `${redisKeyPrefix()}dashboard:world:${encodeURIComponent(characterId)}`;
      await primary.set(key, JSON.stringify(status), "EX", 7 * 86400);
      if (isProduction && config.database?.sync_redis_url) {
        await (await getRedis("sync")).set(key, JSON.stringify(status), "EX", 7 * 86400);
      }
    }
    if (isProduction && config.database?.sync_redis_url) {
      await (await getRedis("sync")).set(
        environmentKey,
        JSON.stringify(environment),
        "EX",
        7 * 86400,
      );
    }
  });
  let historyCopied = false;
  const stopHistory =
    isProduction && config.database?.sync_mongo_uri
      ? startSyncTask("世界历史同步", 30_000, async () => {
          if (historyCopied) {
            return;
          }
          const source = (await getMongoDatabase()).collection<WorldFact>(
            mongoCollectionName("world_events"),
          );
          for await (const fact of source.find({
            occurredAt: { $gt: Date.now() - worldRetentionMs },
          })) {
            await syncWorldFact(fact);
          }
          historyCopied = true;
        })
      : undefined;
  return async () => {
    await Promise.all([stopStatus(), stopHistory?.()]);
  };
}

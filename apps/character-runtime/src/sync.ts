import { load_config } from "@yuiju/shared/config/load";
import type { EmotionStatus } from "@yuiju/shared/dashboard/types";
import { mongoCollectionName, redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { startSyncTask } from "@yuiju/shared/database/sync";
import { getEnvironment } from "@yuiju/shared/env/environment";
import type { Emotion } from "./emotion/emotion";
import { memoryCollection } from "./memory/experiences";

/** 仅生产环境同步公开投影，不复制感受、计划、人物画像、自我认知及聊天原始素材。 */
export async function startCharacterSync(characterId: string, emotion: Emotion) {
  const config = await load_config();
  const isProduction = getEnvironment() === "production";
  const stopEmotion =
    isProduction && config.database?.sync_redis_url
      ? startSyncTask("角色情绪同步", 5_000, async () => {
          const { pleasure, activation, control, updatedAt } = await emotion.read();
          const status: EmotionStatus = { pleasure, activation, control, updatedAt };
          await (await getRedis("sync")).set(
            `${redisKeyPrefix()}dashboard:emotion:${encodeURIComponent(characterId)}`,
            JSON.stringify(status),
            "EX",
            7 * 86400,
          );
        })
      : undefined;
  // 经历记忆已按日、周、月、年归并，数量有限。整份对照同步可同时处理首次补齐与遗忘删除。
  const stopMemory =
    isProduction && config.database?.sync_mongo_uri
      ? startSyncTask("经历记忆同步", 30_000, async () => {
          const memories = await (await memoryCollection())
            .find({ characterId }, { projection: { _id: 0 } })
            .toArray();
          const target = (await getMongoDatabase("sync")).collection(
            mongoCollectionName("character_memories"),
          );
          await target.createIndex({ characterId: 1, id: 1 }, { unique: true });
          for (const memory of memories) {
            const { id, grain, startDate, endDate, text } = memory;
            await target.replaceOne(
              { characterId, id },
              { characterId, id, grain, startDate, endDate, text },
              { upsert: true },
            );
          }
          await target.deleteMany({
            characterId,
            id: { $nin: memories.map((memory) => memory.id) },
          });
        })
      : undefined;
  return async () => {
    await Promise.all([stopEmotion?.(), stopMemory?.()]);
  };
}

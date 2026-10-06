import { mongoCollectionName, redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getMongoDatabase } from "@yuiju/shared/database/mongo";
import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type { ExecuteActionResult } from "@yuiju/shared/world/protocol";
import { createIORedisClient, type IRedisTransaction, Job } from "bullmq";
import type { ChainableCommander } from "ioredis";
import type { WorldFact } from "./events";
import type { WorldEventQueues } from "./queue";
import type { WorldState } from "./state";

export const worldRetentionMs = 30 * 24 * 60 * 60_000;
const prefix = () => `${redisKeyPrefix()}world:`;
export type RequestReceipt = {
  characterId: string;
  requestId: string;
  actionId: string;
  payload: string;
  result: ExecuteActionResult;
  executedAt: number;
};

/** 状态为一个 hash；只覆盖本次改变的字段，不每次重写所有角色。 */
function stateFields(state: WorldState): Record<string, string> {
  return {
    environment: JSON.stringify({
      weather: state.weather,
      weatherPeriod: state.weatherPeriod,
      resourceDate: state.resourceDate,
    }),
    ...Object.fromEntries(
      Object.entries(state.places).map(([id, place]) => [`place:${id}`, JSON.stringify(place)]),
    ),
    ...Object.fromEntries(
      Object.entries(state.characters).map(([id, character]) => [
        `character:${id}`,
        JSON.stringify(character),
      ]),
    ),
  };
}

export async function loadWorldState(): Promise<WorldState | null> {
  const redis = await getRedis();
  const fields = await redis.hgetall(`${prefix()}state`);
  if (Object.keys(fields).length === 0) {
    return null;
  }
  const environment = JSON.parse(fields.environment) as Pick<
    WorldState,
    "weather" | "weatherPeriod" | "resourceDate"
  >;
  return {
    ...environment,
    places: Object.fromEntries(
      Object.entries(fields)
        .filter(([key]) => key.startsWith("place:"))
        .map(([key, value]) => [key.slice(6), JSON.parse(value)]),
    ),
    characters: Object.fromEntries(
      Object.entries(fields)
        .filter(([key]) => key.startsWith("character:"))
        .map(([key, value]) => [key.slice(10), JSON.parse(value)]),
    ),
  };
}

/** 状态、请求结果和两类任务在同一个 Redis MULTI 中提交；不等待消费完成。 */
export async function commitWorldState(
  queues: WorldEventQueues,
  previous: WorldState | null,
  state: WorldState,
  facts: readonly WorldFact[],
  receipt?: RequestReceipt,
): Promise<void> {
  const redis = await getRedis();
  const before = previous === null ? {} : stateFields(previous);
  const updates = Object.fromEntries(
    Object.entries(stateFields(state)).filter(([key, value]) => before[key] !== value),
  );
  if (!Object.keys(updates).length && !facts.length && !receipt) {
    return;
  }
  // BullMQ 的公开 adapter 为 ioredis MULTI 补充 runCommand，原生 SET 等方法仍可使用。
  const transaction = createIORedisClient(redis).multi() as ChainableCommander & IRedisTransaction;
  if (Object.keys(updates).length) {
    transaction.hset(`${prefix()}state`, updates);
  }
  if (receipt) {
    transaction.set(
      `${prefix()}request:${encodeURIComponent(receipt.characterId)}:${encodeURIComponent(receipt.requestId)}`,
      JSON.stringify(receipt),
      "PX",
      worldRetentionMs,
    );
  }
  for (const fact of facts) {
    if (fact.occurredAt <= Date.now() - worldRetentionMs) {
      continue;
    }
    // Job.addJob 只把入队命令加入事务；不能调用 Queue.add 提前独立写入。
    await new Job(queues.archive, "archive", fact, queues.archive.defaultJobOptions).addJob(
      transaction,
    );
    for (const notification of fact.notifications) {
      const queue = queues.notifications.get(notification.characterId)!;
      await new Job(queue, "notify", notification, queue.defaultJobOptions).addJob(transaction);
    }
  }
  const results = await transaction.exec();
  // Redis MULTI 不回滚运行时错误；不能把命令错误或 BullMQ 的负数错误码当成提交成功。
  for (const [error, result] of results!) {
    if (error) {
      throw error;
    }
    if (typeof result === "number" && result < 0) {
      throw new Error(`世界任务入队失败：BullMQ 错误码 ${result}`);
    }
  }
  logger.silly("e2e.world.state.committed", { updates, facts, receipt });
}

export async function readRequestReceipt(
  characterId: string,
  requestId: string,
): Promise<RequestReceipt | null> {
  const value = await (await getRedis()).get(
    `${prefix()}request:${encodeURIComponent(characterId)}:${encodeURIComponent(requestId)}`,
  );
  return value === null ? null : JSON.parse(value);
}

let archiveIndexesCreated = false;
/** 每个事实独立归档；重复消费只按 eventId 命中原记录，不重复插入。 */
export async function archiveWorldFact(fact: WorldFact): Promise<void> {
  const collection = (await getMongoDatabase()).collection(mongoCollectionName("world_events"));
  if (!archiveIndexesCreated) {
    await collection.createIndex({ eventId: 1 }, { unique: true });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    archiveIndexesCreated = true;
  }
  await collection.updateOne(
    { eventId: fact.eventId },
    { $setOnInsert: { ...fact, expiresAt: new Date(fact.occurredAt + worldRetentionMs) } },
    { upsert: true },
  );
}

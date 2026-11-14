import { redisKeyPrefix } from "@yuiju/shared/database/environment";
import { getRedis } from "@yuiju/shared/database/redis";
import type { CalendarItem, CalendarWriteResult } from "@yuiju/shared/world/calendar";
import type { WorldEvent } from "@yuiju/shared/world/protocol";
import { createIORedisClient, type IRedisClient, type IRedisTransaction, Job } from "bullmq";
import type { ChainableCommander } from "ioredis";
import type { WorldEventQueues } from "../queue";
import { worldRetentionMs } from "../storage";

export const calendarKey = () => `${redisKeyPrefix()}world:calendar`;
export type CalendarReceipt = { digest: string; result: CalendarWriteResult };
export type CalendarProgress = { revision: number; lastHandledStartAt: number | null };
export type CalendarSave = {
  item: CalendarItem;
  attentionAt: number | null;
  progress: CalendarProgress | null;
};

export async function readCalendarItem(id: string): Promise<CalendarItem | null> {
  const value = await (await getRedis()).hget(`${calendarKey()}:items`, id);
  return value === null ? null : JSON.parse(value);
}
export async function readCalendarItems(): Promise<CalendarItem[]> {
  return (await (await getRedis()).hvals(`${calendarKey()}:items`)).map((value) =>
    JSON.parse(value),
  );
}
export async function readCalendarProgress(id: string): Promise<CalendarProgress> {
  const value = await (await getRedis()).hget(`${calendarKey()}:reminder-progress`, id);
  if (value === null) {
    throw new Error(`日程缺少投递进度：${id}`);
  }
  return JSON.parse(value);
}
export async function readCalendarReceipt(
  characterId: string,
  requestId: string,
): Promise<CalendarReceipt | null> {
  const value = await (await getRedis()).get(
    `${calendarKey()}:request:${encodeURIComponent(characterId)}:${encodeURIComponent(requestId)}`,
  );
  return value === null ? null : JSON.parse(value);
}
export async function calendarInitialized(characterId: string): Promise<boolean> {
  return (await (await getRedis()).hexists(`${calendarKey()}:initialized`, characterId)) === 1;
}
export async function dueCalendarIds(
  index: "expiry" | "cleanup" | "attention",
  now: number,
): Promise<string[]> {
  return await (await getRedis()).zrangebyscore(`${calendarKey()}:${index}`, "-inf", now);
}

/** 世界修改队列是唯一写入方；正文、索引、初始化标记和通知在同次提交中更新。 */
export async function commitCalendar(
  queues: WorldEventQueues,
  now: number,
  input: {
    saves: CalendarSave[];
    removals: string[];
    notifications: WorldEvent[];
    receipt?: { characterId: string; requestId: string; value: CalendarReceipt };
    initializeCharacterId?: string;
  },
): Promise<void> {
  const key = calendarKey();
  const client: IRedisClient = createIORedisClient(await getRedis());
  const transaction = client.multi() as IRedisTransaction &
    Pick<ChainableCommander, "hdel" | "zrem" | "zadd" | "set">;
  for (const { item, attentionAt, progress } of input.saves) {
    transaction.hset(`${key}:items`, { [item.id]: JSON.stringify(item) });
    for (const index of ["attention", "expiry", "cleanup"]) {
      transaction.zrem(`${key}:${index}`, item.id);
    }
    transaction.zadd(`${key}:cleanup`, item.deleteAt, item.id);
    const active =
      item.kind === "task"
        ? item.status === "pending" || item.status === "in_progress"
        : item.status === "scheduled";
    const expiryAt =
      item.kind === "task"
        ? item.expiresAt
        : item.repeatUntilAt === null
          ? item.endAt
          : item.repeatUntilAt;
    if (active && expiryAt > now) {
      transaction.zadd(`${key}:expiry`, expiryAt, item.id);
      if (attentionAt !== null) {
        transaction.zadd(`${key}:attention`, attentionAt, item.id);
      }
    }
    if (progress !== null) {
      transaction.hset(`${key}:reminder-progress`, { [item.id]: JSON.stringify(progress) });
    }
  }
  for (const id of input.removals) {
    transaction.hdel(`${key}:items`, id);
    transaction.hdel(`${key}:reminder-progress`, id);
    for (const index of ["attention", "expiry", "cleanup"]) {
      transaction.zrem(`${key}:${index}`, id);
    }
  }
  if (input.receipt) {
    const { characterId, requestId, value } = input.receipt;
    transaction.set(
      `${key}:request:${encodeURIComponent(characterId)}:${encodeURIComponent(requestId)}`,
      JSON.stringify(value),
      "PX",
      worldRetentionMs,
    );
  }
  if (input.initializeCharacterId !== undefined) {
    transaction.hset(`${key}:initialized`, { [input.initializeCharacterId]: now });
  }
  for (const event of input.notifications) {
    const queue = queues.notifications.get(event.characterId)!;
    await new Job(queue, "notify", event, queue.defaultJobOptions).addJob(transaction);
  }
  const results = await transaction.exec();
  for (const [error, result] of results!) {
    if (error) {
      throw error;
    }
    if (typeof result === "number" && result < 0) {
      throw new Error(`日历通知入队失败：${result}`);
    }
  }
}

import { getRedis } from "@yuiju/shared/database/redis";
import { logger } from "@yuiju/shared/logger/logger";
import type { ActivityView, WorldEvent } from "@yuiju/shared/world/protocol";
import type { ConversationScope } from "../conversation/message";
import { characterKey } from "../storage";

export type CharacterEvent = {
  id: string;
  occurredAt: number;
} & (
  | { type: "world"; event: WorldEvent }
  | { type: "connected" }
  | { type: "activity_due"; activityId: string; endsAt: number }
  | { type: "plan_attention"; planId: string; attentionAt: number; revision: number }
  | {
      type: "conversation";
      scope: ConversationScope;
      description: string;
      messageIds: string[];
      /** 反馈所回应的主 loop 事件；不填表示独立的群聊信息。 */
      relatedEventId?: string;
    }
);

/** 只负责持久接收；调用方随后显式唤醒，丢失唤醒也能在重启后恢复。 */
export async function receiveCharacterEvent(
  characterId: string,
  event: CharacterEvent,
): Promise<void> {
  const key = characterKey(characterId);
  await (await getRedis()).eval(
    `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'PX', 2592000000)
return 1
`,
    2,
    `${key}:agent:inbox`,
    `${key}:agent:received:${encodeURIComponent(event.id)}`,
    event.id,
    JSON.stringify(event),
  );
  logger.silly("e2e.event.received", { characterId, event });
}

/** 只读当前快照，不在取出时消费；后续抵达的事件留在 inbox 中。 */
export async function readCharacterEvents(characterId: string) {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const [local, world] = await Promise.all([
    redis.hvals(`${key}:agent:inbox`),
    redis.hvals(`${key}:world-inbox`),
  ]);
  const events: CharacterEvent[] = local.map((value) => JSON.parse(value));
  const worldRecords = world.map(
    (value) => JSON.parse(value) as { deliveryId: string; event: WorldEvent },
  );
  worldRecords.sort((a, b) =>
    BigInt(a.deliveryId) < BigInt(b.deliveryId)
      ? -1
      : BigInt(a.deliveryId) > BigInt(b.deliveryId)
        ? 1
        : 0,
  );
  const eventIds = events.map((event) => event.id);
  events.push(
    ...worldRecords.map(
      ({ event }): CharacterEvent => ({
        id: event.eventId,
        occurredAt: event.occurredAt,
        type: "world",
        event,
      }),
    ),
  );
  // 同一时间的世界事件保留服务端提交顺序，不要求先收到的事件已经完成决策。
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  return { events, eventIds, worldEventIds: worldRecords.map(({ event }) => event.eventId) };
}

export type ActivityWait = {
  activityId: string;
  endsAt: number;
  /** 活动时长的 1.5 倍处检查一次；null 表示已触发，不再安排检查。 */
  checkAt: number | null;
};

/** 来自世界查询或执行结果；同一活动重复查询不能抹掉已经安排的检查进度。 */
export async function trackWorldActivity(
  characterId: string,
  activity: ActivityView | null,
): Promise<void> {
  const redis = await getRedis();
  const key = `${characterKey(characterId)}:agent:activity`;
  if (activity === null) {
    await redis.del(key);
    logger.silly("e2e.activity.wait.cleared", { characterId });
    return;
  }
  const waiting: ActivityWait = {
    activityId: activity.activityId,
    endsAt: activity.endsAt,
    checkAt: activity.startedAt + (activity.endsAt - activity.startedAt) * 1.5,
  };
  await redis.eval(
    `
local previous = redis.call('GET', KEYS[1])
if previous then
  local value = cjson.decode(previous)
  if value.activityId == ARGV[1] and value.endsAt == tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[3])
return 1
`,
    1,
    key,
    activity.activityId,
    activity.endsAt,
    JSON.stringify(waiting),
  );
  logger.silly("e2e.activity.wait.tracked", { characterId, waiting });
}

/** 迟到的旧完成事件只能撤销它自己的计时，不能清掉新活动的等待。 */
export async function finishWorldActivityWait(
  characterId: string,
  activityId: string,
): Promise<void> {
  await (await getRedis()).eval(
    `
local value = redis.call('GET', KEYS[1])
if value and cjson.decode(value).activityId == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return redis.call('HDEL', KEYS[2], ARGV[2])
`,
    2,
    `${characterKey(characterId)}:agent:activity`,
    `${characterKey(characterId)}:agent:inbox`,
    activityId,
    `activity:${activityId}`,
  );
  logger.silly("e2e.activity.wait.completed", { characterId, activityId });
}

export async function readActivityWait(characterId: string): Promise<ActivityWait | null> {
  const value = await (await getRedis()).get(`${characterKey(characterId)}:agent:activity`);
  return value === null ? null : JSON.parse(value);
}

/** 写入超时事件并原子清空检查时间；保留活动标识，避免查询或重启后再次安排。 */
export async function signalActivityDue(characterId: string, now: number): Promise<boolean> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const waiting = await readActivityWait(characterId);
  if (!waiting || waiting.checkAt === null || waiting.checkAt > now) {
    return false;
  }
  const event: CharacterEvent = {
    id: `activity:${waiting.activityId}`,
    occurredAt: now,
    type: "activity_due",
    activityId: waiting.activityId,
    endsAt: waiting.endsAt,
  };
  const next = { ...waiting, checkAt: null };
  const result = await redis.eval(
    `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return redis.call('HSETNX', KEYS[2], ARGV[3], ARGV[4])
`,
    2,
    `${key}:agent:activity`,
    `${key}:agent:inbox`,
    JSON.stringify(waiting),
    JSON.stringify(next),
    event.id,
    JSON.stringify(event),
  );
  logger.silly("e2e.activity.due.checked", { characterId, event, inserted: result === 1 });
  return result === 1;
}

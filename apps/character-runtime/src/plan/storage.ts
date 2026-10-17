import { getRedis } from "@yuiju/shared/database/redis";
import type { CharacterEvent } from "../agent-loop/events";
import { characterKey } from "../storage";
import type { Plan } from "./plan";

/** 计划存储只负责读写，不判断计划状态、提醒时机或保留期限。 */
export async function readPlan(characterId: string, planId: string): Promise<Plan | null> {
  const value = await (await getRedis()).hget(`${characterKey(characterId)}:plans`, planId);
  return value === null ? null : JSON.parse(value);
}

export async function readPlans(characterId: string): Promise<Plan[]> {
  const values = await (await getRedis()).hvals(`${characterKey(characterId)}:plans`);
  return values.map((value) => JSON.parse(value) as Plan).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按关注索引查询；索引没有对应计划属于存储契约错误。 */
export async function readDuePlans(characterId: string, now: number): Promise<Plan[]> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const ids = await redis.zrangebyscore(`${key}:plan-attention`, "-inf", now);
  const plans: Plan[] = [];
  for (const id of ids) {
    const plan = await readPlan(characterId, id);
    if (plan === null) {
      throw new Error(`计划关注索引没有对应计划：${id}`);
    }
    plans.push(plan);
  }
  return plans;
}

export async function readNextPlanAttention(characterId: string): Promise<number | null> {
  const result = await (await getRedis()).zrange(
    `${characterKey(characterId)}:plan-attention`,
    0,
    0,
    "WITHSCORES",
  );
  return result.length ? Number(result[1]) : null;
}

/** 比较读取快照后提交新计划，同时更新关注索引、删除旧版本的两种提醒。 */
export async function commitPlan(
  characterId: string,
  previous: Plan | null,
  plan: Plan,
): Promise<boolean> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const saved = await redis.eval(
    `
local previous = redis.call('HGET', KEYS[1], ARGV[1])
if (previous or '') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
if ARGV[4] ~= '' then redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1]) end
if previous then
  local old = cjson.decode(previous)
  redis.call('HDEL', KEYS[3], 'plan:' .. ARGV[1] .. ':' .. old.revision, 'plan-review:' .. ARGV[1] .. ':' .. old.revision)
end
return 1
`,
    3,
    `${key}:plans`,
    `${key}:plan-attention`,
    `${key}:agent:inbox`,
    plan.id,
    previous === null ? "" : JSON.stringify(previous),
    JSON.stringify(plan),
    plan.attentionAt ?? "",
  );
  return saved === 1;
}

/** 计划标记与事件同一次提交，移除已消费的关注索引及该版本原有的执行提醒。 */
export async function publishPlanReminder(
  characterId: string,
  previous: Plan,
  plan: Plan,
  event: Extract<CharacterEvent, { type: "plan_attention" | "plan_review" }>,
): Promise<boolean> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const saved = await redis.eval(
    `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[4])
redis.call('HSET', KEYS[3], ARGV[5], ARGV[6])
return 1
`,
    3,
    `${key}:plans`,
    `${key}:plan-attention`,
    `${key}:agent:inbox`,
    plan.id,
    JSON.stringify(previous),
    JSON.stringify(plan),
    `plan:${plan.id}:${previous.revision}`,
    event.id,
    JSON.stringify(event),
  );
  return saved === 1;
}

/** 只删除仍与读取快照相同的计划，关联索引与两种提醒一并清除。 */
export async function deletePlan(characterId: string, plan: Plan): Promise<boolean> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const removed = await redis.eval(
    `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[3], ARGV[4])
return 1
`,
    3,
    `${key}:plans`,
    `${key}:plan-attention`,
    `${key}:agent:inbox`,
    plan.id,
    JSON.stringify(plan),
    `plan:${plan.id}:${plan.revision}`,
    `plan-review:${plan.id}:${plan.revision}`,
  );
  return removed === 1;
}

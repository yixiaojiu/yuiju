import { load_config } from "@yuiju/shared/config/load";
import { getRedis } from "@yuiju/shared/database/redis";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import type { CharacterEvent } from "../agent-loop/events";
import { characterKey } from "../storage";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export const planInputSchema = z.strictObject({
  content: z.string().min(1).describe("你打算做什么"),
  background: z.string().describe("这项打算的由来"),
  plannedAt: z.number().int().nullable().describe("安排的时间，Unix 毫秒；未定时填 null"),
  attentionAt: z
    .number()
    .int()
    .nullable()
    .describe("你下次想关注的时间，Unix 毫秒；无需关注填 null"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  progress: z.string().describe("已有进展，不把打算当作完成"),
});

/** 模型填写项目时区的本地时间，程序转换为持久化使用的 Unix 毫秒。 */
export const planToolSchema = planInputSchema.extend({
  plannedAt: z.string().nullable().describe("安排时间，项目时区 YYYY-MM-DD HH:mm；未定填 null"),
  attentionAt: z
    .string()
    .nullable()
    .describe("下次关注时间，项目时区 YYYY-MM-DD HH:mm；无需关注填 null"),
});

export function parsePlanTimes(
  input: z.infer<typeof planToolSchema>,
  timezone: string,
): z.infer<typeof planInputSchema> {
  const parse = (value: string | null) => {
    if (value === null) {
      return null;
    }
    const time = dayjs.tz(value, "YYYY-MM-DD HH:mm", timezone);
    if (!time.isValid() || time.format("YYYY-MM-DD HH:mm") !== value) {
      throw new Error(`计划时间格式无效：${value}，请使用 YYYY-MM-DD HH:mm`);
    }
    return time.valueOf();
  };
  return { ...input, plannedAt: parse(input.plannedAt), attentionAt: parse(input.attentionAt) };
}

export type Plan = z.infer<typeof planInputSchema> & {
  id: string;
  revision: number;
  updatedAt: number;
  /** 同一工具调用恢复时，不重复递增版本或重排计时。 */
  operationId: string;
};

export async function readPlans(characterId: string): Promise<Plan[]> {
  const values = await (await getRedis()).hvals(`${characterKey(characterId)}:plans`);
  return values.map((value) => JSON.parse(value) as Plan).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function formatPlans(plans: Plan[]): Promise<string> {
  const timezone = (await load_config()).app!.timezone!;
  return (
    plans
      .map((plan) =>
        [
          `${plan.content}（planId=${plan.id}，${plan.status}）`,
          `背景：${plan.background}；进展：${plan.progress}`,
          `计划时间：${plan.plannedAt === null ? "未定" : formatLlmDateTime(plan.plannedAt, timezone)}`,
          `下次关注：${plan.attentionAt === null ? "未安排" : formatLlmDateTime(plan.attentionAt, timezone)}`,
        ].join("\n"),
      )
      .join("\n\n") || "没有已记录的安排。"
  );
}

/** 新建与修改共用计划结构；id 由程序生成，更新必须指定已有计划。 */
export async function savePlan(
  characterId: string,
  id: string,
  input: z.infer<typeof planInputSchema>,
  operationId: string,
  create: boolean,
): Promise<Plan> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const stored = await redis.hget(`${key}:plans`, id);
  const previous: Plan | null = stored === null ? null : JSON.parse(stored);
  if (previous?.operationId === operationId) {
    return previous;
  }
  if (create ? previous !== null : previous === null) {
    throw new Error(create ? `计划已经存在：${id}` : `计划不存在：${id}`);
  }
  const active = input.status === "pending" || input.status === "in_progress";
  if (!active && input.attentionAt !== null) {
    throw new Error("已结束的计划不能保留下次关注时间");
  }
  const plan: Plan = {
    ...input,
    id,
    revision: (previous?.revision ?? 0) + 1,
    operationId,
    updatedAt: Date.now(),
  };
  // 计划、计时及旧关注事件在同一次提交中改变，不靠删除 timer 保证失效。
  const saved = await redis.eval(
    `
local previous = redis.call('HGET', KEYS[1], ARGV[1])
if (previous or '') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
if ARGV[4] ~= '' then redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1]) end
if previous then
  local old = cjson.decode(previous)
  redis.call('HDEL', KEYS[3], 'plan:' .. ARGV[1] .. ':' .. old.revision)
end
return 1
`,
    3,
    `${key}:plans`,
    `${key}:plan-attention`,
    `${key}:agent:inbox`,
    id,
    stored ?? "",
    JSON.stringify(plan),
    plan.attentionAt ?? "",
  );
  if (saved !== 1) {
    throw new Error("计划在保存前发生变化，请重新读取后修改");
  }
  return plan;
}

/** 到点只消费本次关注时间并生成输入，不自动改变计划状态或执行行动。 */
export async function signalPlansDue(characterId: string, now: number): Promise<void> {
  const redis = await getRedis();
  const key = characterKey(characterId);
  const ids = await redis.zrangebyscore(`${key}:plan-attention`, "-inf", now);
  for (const id of ids) {
    const stored = await redis.hget(`${key}:plans`, id);
    if (stored === null) {
      throw new Error(`计划关注索引没有对应计划：${id}`);
    }
    const plan: Plan = JSON.parse(stored);
    if (plan.attentionAt === null || plan.attentionAt > now) {
      continue;
    }
    const event: CharacterEvent = {
      id: `plan:${id}:${plan.revision}`,
      type: "plan_attention",
      occurredAt: now,
      planId: id,
      attentionAt: plan.attentionAt,
      revision: plan.revision,
    };
    await redis.eval(
      `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
return 1
`,
      3,
      `${key}:plans`,
      `${key}:plan-attention`,
      `${key}:agent:inbox`,
      id,
      stored,
      JSON.stringify({ ...plan, attentionAt: null }),
      event.id,
      JSON.stringify(event),
    );
  }
}

export async function nextPlanAttention(characterId: string): Promise<number | null> {
  const result = await (await getRedis()).zrange(
    `${characterKey(characterId)}:plan-attention`,
    0,
    0,
    "WITHSCORES",
  );
  return result.length ? Number(result[1]) : null;
}

/** 清理旧的结束记录时比较原值，不能删除刚被主 loop 修改或重新启用的计划。 */
export async function forgetEndedPlans(characterId: string, before: number): Promise<void> {
  const redis = await getRedis();
  const key = `${characterKey(characterId)}:plans`;
  for (const [id, value] of Object.entries(await redis.hgetall(key))) {
    const plan: Plan = JSON.parse(value);
    if ((plan.status === "completed" || plan.status === "cancelled") && plan.updatedAt < before) {
      await redis.eval(
        `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
return redis.call('HDEL', KEYS[1], ARGV[1])
`,
        1,
        key,
        id,
        value,
      );
    }
  }
}

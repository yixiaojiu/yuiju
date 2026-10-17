import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import type { CharacterEvent } from "../agent-loop/events";
import {
  commitPlan,
  deletePlan,
  publishPlanReminder,
  readDuePlans,
  readNextPlanAttention,
  readPlan,
  readPlans,
} from "./storage";

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
const planToolFields = planInputSchema.extend({
  plannedAt: z.string().nullable().describe("安排时间，项目时区 YYYY-MM-DD HH:mm；未定填 null"),
  attentionAt: z
    .string()
    .nullable()
    .describe("下次关注时间，项目时区 YYYY-MM-DD HH:mm；无需关注填 null"),
});

/** 新建只要求内容，状态与初始进展由程序设置。 */
export const createPlanSchema = planToolFields
  .pick({ content: true, background: true, plannedAt: true, attentionAt: true })
  .partial({ background: true, plannedAt: true, attentionAt: true });

/** 更新仅提交变化字段；省略表示保留原值，时间传 null 表示清除。 */
export const updatePlanSchema = planToolFields
  .partial()
  .extend({ planId: z.string().min(1).describe("你要修改的已有计划 ID") })
  .refine(
    (input) =>
      Object.entries(input).some(([key, value]) => key !== "planId" && value !== undefined),
    "至少提供一个要修改的计划字段",
  );

export function parsePlanTimes(
  input: Partial<z.infer<typeof planToolFields>>,
  timezone: string,
): Partial<z.infer<typeof planInputSchema>> {
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
  const { plannedAt, attentionAt, ...fields } = input;
  return {
    ...fields,
    ...(plannedAt !== undefined && { plannedAt: parse(plannedAt) }),
    ...(attentionAt !== undefined && { attentionAt: parse(attentionAt) }),
  };
}

export type Plan = z.infer<typeof planInputSchema> & {
  id: string;
  revision: number;
  updatedAt: number;
  /** 同一工具调用恢复时，不重复递增版本或重排计时。 */
  operationId: string;
  /** 当前版本已发出维护提醒的时间；agent 更新计划后移除，超过 24 小时由每日任务清理。 */
  reviewRequestedAt?: number;
};

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
          ...(plan.reviewRequestedAt === undefined
            ? []
            : [
                `维护提醒：${formatLlmDateTime(plan.reviewRequestedAt, timezone)}；24 小时未更新后会被每日任务移除`,
              ]),
        ].join("\n"),
      )
      .join("\n\n") || "没有已记录的安排。"
  );
}

/** 创建设置初始状态，更新合并已提交字段；同次提交同步清理旧提醒。 */
export async function savePlan(
  characterId: string,
  id: string,
  input: Partial<z.infer<typeof planInputSchema>>,
  operationId: string,
  create: boolean,
): Promise<Plan> {
  const previous = await readPlan(characterId, id);
  if (previous?.operationId === operationId) {
    return previous;
  }
  if (create ? previous !== null : previous === null) {
    throw new Error(create ? `计划已经存在：${id}` : `计划不存在：${id}`);
  }
  const fields = planInputSchema.parse(
    create
      ? {
          background: "",
          plannedAt: null,
          attentionAt: null,
          ...input,
          status: "pending",
          progress: "",
        }
      : {
          content: previous!.content,
          background: previous!.background,
          plannedAt: previous!.plannedAt,
          attentionAt: previous!.attentionAt,
          status: previous!.status,
          progress: previous!.progress,
          ...input,
        },
  );
  if (fields.status === "completed" || fields.status === "cancelled") {
    fields.attentionAt = null;
  }
  const plan: Plan = {
    ...fields,
    id,
    revision: (previous?.revision ?? 0) + 1,
    operationId,
    updatedAt: Date.now(),
  };
  // 存储层原子更新计划、关注索引及旧提醒；冲突后由调用方重新决策。
  if (!(await commitPlan(characterId, previous, plan))) {
    throw new Error("计划在保存前发生变化，请重新读取后修改");
  }
  return plan;
}

/** 维护提醒独立于执行提醒；已通知的版本不再安排提醒。 */
function planReviewAt(plan: Plan, timezone: string): number | null {
  if (
    (plan.status !== "pending" && plan.status !== "in_progress") ||
    plan.reviewRequestedAt !== undefined
  ) {
    return null;
  }
  if (plan.plannedAt === null) {
    return plan.updatedAt + 7 * 86_400_000;
  }
  // 更新过的计划至少留到次日再检查，避免仍保留过去日期时同一轮反复提醒。
  const date = dayjs(Math.max(plan.plannedAt, plan.updatedAt)).tz(timezone).format("YYYY-MM-DD");
  return dayjs.tz(dayjs.utc(date).add(1, "day").format("YYYY-MM-DD"), timezone).valueOf();
}

/** 到点生成执行提醒或维护提醒；不自动改变计划状态或执行行动。 */
export async function signalPlansDue(characterId: string, now: number): Promise<void> {
  for (const plan of await readDuePlans(characterId, now)) {
    if (plan.attentionAt === null || plan.attentionAt > now) {
      continue;
    }
    const event: CharacterEvent = {
      id: `plan:${plan.id}:${plan.revision}`,
      type: "plan_attention",
      occurredAt: now,
      planId: plan.id,
      attentionAt: plan.attentionAt,
      revision: plan.revision,
    };
    await publishPlanReminder(characterId, plan, { ...plan, attentionAt: null }, event);
  }

  const timezone = (await load_config()).app!.timezone!;
  for (const plan of await readPlans(characterId)) {
    const reviewAt = planReviewAt(plan, timezone);
    if (reviewAt === null || reviewAt > now) {
      continue;
    }
    const event: CharacterEvent = {
      id: `plan-review:${plan.id}:${plan.revision}`,
      type: "plan_review",
      occurredAt: now,
      planId: plan.id,
      revision: plan.revision,
    };
    await publishPlanReminder(
      characterId,
      plan,
      { ...plan, attentionAt: null, reviewRequestedAt: now },
      event,
    );
  }
}

/** 调度执行提醒和维护提醒的最早时间；已发出维护提醒的计划不会循环唤醒。 */
export async function nextPlanAttention(characterId: string): Promise<number | null> {
  const attentionAt = await readNextPlanAttention(characterId);
  const timezone = (await load_config()).app!.timezone!;
  const times = (await readPlans(characterId))
    .map((plan) => planReviewAt(plan, timezone))
    .filter((time): time is number => time !== null);
  if (attentionAt !== null) {
    times.push(attentionAt);
  }
  return times.length ? Math.min(...times) : null;
}

/** 仅由每日任务清理；维护提醒至少保留 24 小时，结束记录保留 30 天。 */
export async function cleanupPlans(characterId: string, now: number): Promise<number> {
  let removed = 0;
  for (const plan of await readPlans(characterId)) {
    const ended = plan.status === "completed" || plan.status === "cancelled";
    const expired = ended
      ? plan.updatedAt < now - 30 * 86_400_000
      : plan.reviewRequestedAt !== undefined && plan.reviewRequestedAt <= now - 86_400_000;
    if (!expired) {
      continue;
    }
    if (await deletePlan(characterId, plan)) {
      removed += 1;
    }
  }
  return removed;
}

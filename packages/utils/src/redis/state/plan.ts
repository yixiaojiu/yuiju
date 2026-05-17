import { isDev } from "../../env";
import type { PlanState } from "../../types";
import { safeParseJson } from "../../utils";
import { getRedis, type RedisReadSource, syncRedisStateWrite } from "../client";

export const REDIS_KEY_PLAN_STATE = isDev() ? "dev:yuiju:plan:state" : "yuiju:plan:state";

const DEFAULT_PLAN_STATE: PlanState = {
  shortTermPlans: [],
  updatedAt: new Date(0).toISOString(),
};

type InitPlanStateDataOptions = {
  readFrom?: RedisReadSource;
};

/**
 * 读取当前计划状态。
 *
 * 说明：
 * - 计划状态使用单个 Redis String 保存，避免多 key 更新时出现中间态；
 * - 读取失败或数据损坏时，回退到空计划状态。
 */
export const initPlanStateData = async (
  options: InitPlanStateDataOptions = {},
): Promise<PlanState> => {
  const readFrom = options.readFrom ?? "primary";
  const redis = getRedis(readFrom);
  const raw = await redis.get(REDIS_KEY_PLAN_STATE);

  if (!raw) {
    if (readFrom === "sync") {
      return { ...DEFAULT_PLAN_STATE, shortTermPlans: [] };
    }

    await savePlanStateData(DEFAULT_PLAN_STATE);
    return { ...DEFAULT_PLAN_STATE, shortTermPlans: [] };
  }

  const parsed = safeParseJson<PlanState>(raw);
  if (!parsed || typeof parsed !== "object") {
    if (readFrom === "sync") {
      return { ...DEFAULT_PLAN_STATE, shortTermPlans: [] };
    }

    await savePlanStateData(DEFAULT_PLAN_STATE);
    return { ...DEFAULT_PLAN_STATE, shortTermPlans: [] };
  }

  const maybeState = parsed as Partial<PlanState>;
  const shortTermPlans = Array.isArray(maybeState.shortTermPlans) ? maybeState.shortTermPlans : [];
  const longTermPlan = maybeState.longTermPlan;

  return {
    longTermPlan,
    shortTermPlans,
    updatedAt:
      typeof maybeState.updatedAt === "string"
        ? maybeState.updatedAt
        : DEFAULT_PLAN_STATE.updatedAt,
  };
};

/**
 * 保存当前计划状态。
 */
export const savePlanStateData = async (state: PlanState): Promise<void> => {
  const redis = getRedis();
  const planStateValue = JSON.stringify(state);
  await redis.set(REDIS_KEY_PLAN_STATE, planStateValue);
  await syncRedisStateWrite({
    command: "set",
    key: REDIS_KEY_PLAN_STATE,
    value: planStateValue,
  });
};

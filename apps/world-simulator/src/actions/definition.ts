import type { ConditionView, JsonObject, JsonValue } from "@yuiju/shared/world/protocol";
import type { z } from "zod";
import type { WorldMap } from "../map";
import type { RunningActivity, WorldCharacterState, WorldState } from "../state";

export type ActionContext = {
  state: WorldState;
  character: WorldCharacterState;
  map: WorldMap;
  now: number;
  timezone: string;
  /** 查询目标不改变角色的实际位置。 */
  placeId: string | null;
  knownPlaceIds: ReadonlySet<string>;
  purpose: "inspect" | "execute";
};
export type ActionCondition = {
  description: string;
  check: (context: ActionContext) => ConditionView["status"];
};
export type ActionStart = { durationMinutes: number; settlement: JsonObject; description: string };
export type ActionCompletion = {
  description: string;
};
export type ActionDefinition = {
  id: string;
  description: string;
  placeIds: readonly string[] | null;
  identities: readonly string[];
  schema: z.ZodType;
  durationDescription: string;
  conditions: ActionCondition[];
  /** 到期后先在队列外生成小插曲，再与活动结算一起提交。 */
  randomEvent?: { probability: number; positiveProbability: number };
  options?: (context: ActionContext) => JsonValue[];
  checkParameters?: (context: ActionContext, payload: JsonObject) => ConditionView[];
  start: (context: ActionContext, payload: JsonObject) => ActionStart;
  complete: (context: ActionContext, activity: RunningActivity) => ActionCompletion;
};

/** 保留各行动自己的参数和结算类型，注册后仅在已校验的执行边界擦除类型。 */
export function defineAction<P extends JsonObject, S extends JsonObject>(
  definition: Omit<ActionDefinition, "schema" | "checkParameters" | "start" | "complete"> & {
    schema: z.ZodType<P>;
    checkParameters?: (context: ActionContext, payload: P) => ConditionView[];
    start: (
      context: ActionContext,
      payload: P,
    ) => Omit<ActionStart, "settlement"> & { settlement: S };
    complete: (context: ActionContext, settlement: S, payload: P) => ActionCompletion;
  },
): ActionDefinition {
  return {
    ...definition,
    checkParameters: definition.checkParameters
      ? (context, payload) => definition.checkParameters!(context, payload as P)
      : undefined,
    start: (context, payload) => definition.start(context, payload as P),
    complete: (context, activity) =>
      definition.complete(context, activity.settlement as S, activity.payload as P),
  };
}

/** 规则展示与执行共用同一判断，不在 API 或工具里复制条件。 */
export function evaluateConditions(
  conditions: readonly ActionCondition[],
  context: ActionContext,
): ConditionView[] {
  return conditions.map((condition) => ({
    description: condition.description,
    status: condition.check(context),
  }));
}

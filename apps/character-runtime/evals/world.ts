import type {
  ExecuteActionInput,
  ExecuteActionResult,
  InspectWorldInput,
  WorldResult,
} from "@yuiju/shared/world/protocol";
import { actionsById } from "../../world-simulator/src/actions/definitions";
import {
  createActionContext,
  settleActivity,
  startAction,
} from "../../world-simulator/src/actions/execution";
import { characterDefinitions } from "../../world-simulator/src/content/characters";
import { places, routes } from "../../world-simulator/src/content/locations";
import {
  actionConditions,
  actionIsKnown,
  inspectWorld,
  parseActionPayload,
} from "../../world-simulator/src/inspect";
import { createWorldMap } from "../../world-simulator/src/map";
import type { WorldState } from "../../world-simulator/src/state";

/**
 * 测评只隔离网络与持久化，查询和行动使用真实世界规则。
 * 时间固定在本轮开始，不启动 tick；持续活动只开始，不提前结算或推送完成通知。
 * 所有操作同步修改本次测评独有的内存状态。
 */
export function createEvaluationWorld(initialState: WorldState, now: number, timezone: string) {
  const state = structuredClone(initialState);
  const map = createWorldMap(places, routes);
  const definition = characterDefinitions.find((item) => item.characterId === "yuuno")!;
  const names = new Map([[definition.characterId, "雨泽悠乃"]]);

  return {
    state,
    inspect(input: InspectWorldInput) {
      return inspectWorld(
        input,
        createActionContext(state, definition, map, now, timezone, "inspect"),
        definition,
        names,
      );
    },
    execute(input: ExecuteActionInput): WorldResult<ExecuteActionResult> {
      const action = actionsById.get(input.actionId);
      if (!action || !actionIsKnown(action, definition)) {
        return { ok: false, code: "action_not_available", message: "角色没有这个行动" };
      }
      const payload = parseActionPayload(action, input.payload);
      if (!payload.ok) {
        return payload;
      }
      const context = createActionContext(state, definition, map, now, timezone, "execute");
      const conditions = actionConditions(action, context, payload.value);
      if (conditions.some((condition) => condition.status !== "met")) {
        return {
          ok: false,
          code: "conditions_not_met",
          message: "当前无法执行这个行动",
          conditions,
        };
      }

      const { result } = startAction(context, action, payload.value, names);
      if (result.status === "completed") {
        settleActivity(state, definition, map, names, timezone);
      }
      return { ok: true, value: result };
    },
  };
}

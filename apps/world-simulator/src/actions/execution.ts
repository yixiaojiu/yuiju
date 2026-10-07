import { randomUUID } from "node:crypto";
import type { ExecuteActionResult, JsonObject } from "@yuiju/shared/world/protocol";
import type { WorldCharacterDefinition } from "../content/characters";
import { createWorldFact, type WorldFact } from "../events";
import { activityView } from "../inspect";
import { getKnownPlaceIds, type WorldMap } from "../map";
import type { WorldState } from "../state";
import { createIdleActivity } from "./anywhere";
import type { ActionContext, ActionDefinition } from "./definition";
import { actionsById } from "./definitions";

/** character 引用传入 state 内的角色；执行行动时必须传入可修改的状态副本。 */
export function createActionContext(
  state: WorldState,
  definition: WorldCharacterDefinition,
  map: WorldMap,
  now: number,
  timezone: string,
  purpose: ActionContext["purpose"],
): ActionContext {
  const character = state.characters[definition.characterId];
  return {
    state,
    character,
    map,
    now,
    timezone,
    placeId: character.placeId,
    knownPlaceIds: getKnownPlaceIds(map, definition.familiarPlaceIds, character.placeId),
    purpose,
  };
}

/** 参数和条件已由调用方检查；修改副本、建立活动并生成开始事实，不提交数据库。 */
export function startAction(
  draftContext: ActionContext,
  action: ActionDefinition,
  payload: JsonObject,
  characterNames: ReadonlyMap<string, string>,
): { result: ExecuteActionResult; facts: WorldFact[] } {
  const { state: draftState, character, map, now, timezone } = draftContext;
  const fromPlaceId = character.placeId;
  const started = action.start(draftContext, payload);
  const activity = {
    activityId: randomUUID(),
    actionId: action.id,
    payload,
    startedAt: now,
    endsAt: now + started.durationMinutes * 60_000,
    settlement: started.settlement,
  };
  character.currentActivity = activity;
  const fact = createWorldFact(
    {
      occurredAt: now,
      type: "activity_started",
      characterId: character.characterId,
      placeId: fromPlaceId,
      activity: activityView(activity),
      description: started.description,
    },
    draftState,
    map,
    characterNames,
    timezone,
  );
  return {
    result: {
      status: activity.endsAt === now ? "completed" : "started",
      activity: activityView(activity),
      description: started.description,
    },
    facts: [fact],
  };
}

/** 结算副本中的当前活动并进入空闲发呆，返回完成事实；小插曲只补充文字，不单独提交。 */
export function settleActivity(
  draftState: WorldState,
  definition: WorldCharacterDefinition,
  map: WorldMap,
  characterNames: ReadonlyMap<string, string>,
  timezone: string,
  randomEventDescription?: string,
): WorldFact {
  const character = draftState.characters[definition.characterId];
  const activity = character.currentActivity!;
  const action = actionsById.get(activity.actionId)!;
  const completed = action.complete(
    createActionContext(draftState, definition, map, activity.endsAt!, timezone, "execute"),
    activity,
  );
  character.currentActivity = createIdleActivity(activity.endsAt!);
  return createWorldFact(
    {
      occurredAt: activity.endsAt!,
      type: "activity_completed",
      characterId: character.characterId,
      placeId: character.placeId,
      activity: activityView(activity),
      description: randomEventDescription
        ? `${completed.description}\n${randomEventDescription}`
        : completed.description,
    },
    draftState,
    map,
    characterNames,
    timezone,
  );
}

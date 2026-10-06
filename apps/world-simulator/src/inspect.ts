import type {
  ActivityView,
  ConditionView,
  InspectWorldInput,
  InspectWorldResult,
  JsonObject,
  ObservationView,
  PositionView,
  RoutePathView,
  RouteView,
  WorldResult,
} from "@yuiju/shared/world/protocol";
import { z } from "zod";
import {
  type ActionContext,
  type ActionDefinition,
  evaluateConditions,
} from "./actions/definition";
import { actions, actionsById } from "./actions/definitions";
import type { WorldCharacterDefinition } from "./content/characters";
import { openingHours } from "./environment/places";
import {
  findKnownRoutePath,
  getPlacePath,
  getSpatialRelation,
  placeRef,
  type RouteDefinition,
  type WorldMap,
} from "./map";
import type { RunningActivity, WorldCharacterState } from "./state";

/** 只暴露活动概况，结算快照是世界内部数据。 */
export function activityView(activity: RunningActivity): ActivityView {
  return {
    activityId: activity.activityId,
    actionId: activity.actionId,
    startedAt: activity.startedAt,
    endsAt: activity.endsAt,
  };
}

export function positionView(character: WorldCharacterState, map: WorldMap): PositionView {
  if (character.placeId !== null) {
    return {
      type: "at_place",
      place: placeRef(map.placesById.get(character.placeId)!),
      hierarchy: getPlacePath(map, character.placeId).map(placeRef),
    };
  }
  // placeId 为 null 只可能发生在已提交的移动活动中。
  const activity = character.currentActivity!;
  const movement = activity.settlement as {
    routeId: string;
    fromPlaceId: string;
    toPlaceId: string;
  };
  return {
    type: "moving",
    activityId: activity.activityId,
    routeId: movement.routeId,
    from: placeRef(map.placesById.get(movement.fromPlaceId)!),
    to: placeRef(map.placesById.get(movement.toPlaceId)!),
    startedAt: activity.startedAt,
    endsAt: activity.endsAt,
  };
}

export function actionIsKnown(
  action: ActionDefinition,
  definition: WorldCharacterDefinition,
): boolean {
  return action.identities.every((identity) => definition.identities.includes(identity));
}

/** 世界查询与请求执行共用参数校验，错误供角色修正，不补值或修复 JSON。 */
export function parseActionPayload(
  action: ActionDefinition,
  payload: string,
): WorldResult<JsonObject> {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { ok: false, code: "invalid_payload", message: "payload 必须是有效的 JSON 字符串" };
  }
  const result = action.schema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      code: "invalid_payload",
      message: result.error.issues
        .map((issue) => `${issue.path.join(".") || "payload"}：${issue.message}`)
        .join("；"),
    };
  }
  return { ok: true, value: result.data as JsonObject };
}

export function actionConditions(
  action: ActionDefinition,
  context: ActionContext,
  payload?: JsonObject,
): ConditionView[] {
  const conditions: ConditionView[] = [
    {
      description: "当前没有其他进行中的活动",
      status: context.character.currentActivity === null ? "met" : "unmet",
    },
  ];
  if (action.placeIds !== null) {
    conditions.push({
      description: `位于${action.placeIds.map((id) => context.map.placesById.get(id)!.name).join("或")}`,
      status:
        context.character.placeId !== null && action.placeIds.includes(context.character.placeId)
          ? "met"
          : "unmet",
    });
  }
  conditions.push(...evaluateConditions(action.conditions, context));
  if (action.checkParameters) {
    if (payload === undefined) {
      conditions.push({ description: "选择参数后检查具体执行条件", status: "needs_parameters" });
    } else {
      conditions.push(...action.checkParameters(context, payload));
    }
  }
  return conditions;
}

function routeView(route: RouteDefinition, context: ActionContext): RouteView {
  return {
    routeId: route.id,
    from: placeRef(context.map.placesById.get(route.fromPlaceId)!),
    to: placeRef(context.map.placesById.get(route.toPlaceId)!),
    kind: route.kind,
    mode: route.mode,
    durationMinutes: route.durationMinutes,
    cost: route.cost,
    conditions: evaluateConditions(route.conditions, context),
  };
}

/** 第一版现场感知仅限当前具体地点，父区域不聚合远处现场。 */
export function observePlace(
  placeId: string | null,
  context: Pick<ActionContext, "state" | "character" | "now" | "timezone">,
  names: ReadonlyMap<string, string>,
): ObservationView {
  if (placeId === null || placeId !== context.character.placeId) {
    return { status: "not_observed" };
  }
  const state = context.state.places[placeId];
  return {
    status: "observed",
    weather: `${context.state.weather.type}，体感${context.state.weather.temperatureLevel}`,
    isOpen: state.isOpen,
    characters: Object.values(context.state.characters)
      .filter((character) => character.placeId === placeId)
      .map((character) => ({
        characterId: character.characterId,
        name: names.get(character.characterId)!,
      })),
    resources: Object.entries(state.resources).map(([itemId, quantity]) => ({
      itemId,
      name: itemId,
      quantity,
    })),
  };
}

/** 在角色视角内组装响应；内部坐标和未知私人地点不会被序列化给客户端。 */
export function inspectWorld(
  input: InspectWorldInput,
  context: ActionContext,
  definition: WorldCharacterDefinition,
  names: ReadonlyMap<string, string>,
): WorldResult<InspectWorldResult> {
  if (input.type === "relation") {
    if (
      !context.knownPlaceIds.has(input.fromPlaceId) ||
      !context.knownPlaceIds.has(input.toPlaceId)
    ) {
      return { ok: false, code: "place_not_known", message: "无法查询未知地点的关系" };
    }
    const directRoutes = context.map.routesByFromPlaceId
      .get(input.fromPlaceId)!
      .filter((route) => route.toPlaceId === input.toPlaceId)
      .map((route) => routeView(route, context));
    const routePath = findKnownRoutePath(
      context.map,
      input.fromPlaceId,
      input.toPlaceId,
      context.knownPlaceIds,
    );
    let path: RoutePathView;
    if (routePath === null) {
      path = { status: "no_known_path" };
    } else if (routePath.length === 0) {
      path = { status: "same_place" };
    } else {
      path = {
        status: "found",
        steps: routePath.map((route) => routeView(route, context)),
        totalDurationMinutes: routePath.reduce((sum, route) => sum + route.durationMinutes, 0),
        totalCost: routePath.reduce(
          (sum, route) => ({
            money: sum.money + route.cost.money,
            stamina: sum.stamina + route.cost.stamina,
            satiety: sum.satiety + route.cost.satiety,
          }),
          { money: 0, stamina: 0, satiety: 0 },
        ),
      };
    }
    return {
      ok: true,
      value: {
        type: "relation",
        from: placeRef(context.map.placesById.get(input.fromPlaceId)!),
        to: placeRef(context.map.placesById.get(input.toPlaceId)!),
        spatial: getSpatialRelation(context.map, input.fromPlaceId, input.toPlaceId),
        directRoutes,
        path,
      },
    };
  }

  const placeId =
    input.type === "place"
      ? input.placeId
      : input.type === "action" && input.placeId !== undefined
        ? input.placeId
        : context.character.placeId;
  if (placeId !== null && !context.knownPlaceIds.has(placeId)) {
    return { ok: false, code: "place_not_known", message: "无法查询未知地点" };
  }
  const queryContext = { ...context, placeId };
  if (input.type === "action") {
    const action = actionsById.get(input.actionId);
    if (!action || !actionIsKnown(action, definition)) {
      return { ok: false, code: "action_not_available", message: "没有可查询的该行动" };
    }
    if (action.placeIds !== null && placeId === null) {
      return {
        ok: false,
        code: "place_required",
        message: "移动期间查询地点行动需要指定已知 placeId",
      };
    }
    if (action.placeIds !== null && !action.placeIds.includes(placeId!)) {
      return { ok: false, code: "action_not_available", message: "该地点不提供此行动" };
    }
    let payload: JsonObject | undefined;
    if (input.payload !== undefined) {
      const parsed = parseActionPayload(action, input.payload);
      if (!parsed.ok) {
        return parsed;
      }
      payload = parsed.value;
    }
    return {
      ok: true,
      value: {
        type: "action",
        actionId: action.id,
        description: action.description,
        payloadSchema: z.toJSONSchema(action.schema),
        options: action.options ? action.options(queryContext) : [],
        conditions: actionConditions(action, queryContext, payload),
        durationDescription: action.durationDescription,
      },
    };
  }

  const routes =
    placeId === null
      ? []
      : context.map.routesByFromPlaceId
          .get(placeId)!
          .filter((route) => context.knownPlaceIds.has(route.toPlaceId))
          .map((route) => routeView(route, queryContext));
  const summaries = actions
    .filter(
      (action) =>
        actionIsKnown(action, definition) &&
        (action.placeIds === null || (placeId !== null && action.placeIds.includes(placeId))),
    )
    .map((action) => ({ actionId: action.id, description: action.description }));
  const observation = observePlace(placeId, context, names);
  if (input.type === "place") {
    const place = context.map.placesById.get(input.placeId)!;
    return {
      ok: true,
      value: {
        type: "place",
        place: placeRef(place),
        hierarchy: getPlacePath(context.map, input.placeId).map(placeRef),
        description: place.description,
        openingHours: openingHours[place.id] ?? null,
        children: context.map.childrenByParentId
          .get(input.placeId)!
          .filter((child) => context.knownPlaceIds.has(child.id))
          .map(placeRef),
        routes,
        actions: summaries,
        observation,
      },
    };
  }
  const character = context.character;
  return {
    ok: true,
    value: {
      type: "current",
      now: context.now,
      position: positionView(character, context.map),
      activity: character.currentActivity ? activityView(character.currentActivity) : null,
      body: { stamina: character.stamina, satiety: character.satiety },
      money: character.money,
      phoneBattery: character.phoneBattery,
      inventory: Object.entries(character.inventory).map(([itemId, quantity]) => ({
        itemId,
        name: itemId,
        quantity,
      })),
      routes,
      actions: summaries,
      observation,
    },
  };
}

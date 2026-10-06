import { z } from "zod";

/** JSON 形态用于持久化结算依据和模型提供的行动参数。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const inspectWorldSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("current") }),
  z.strictObject({ type: z.literal("places"), query: z.string().trim().min(1).optional() }),
  z.strictObject({ type: z.literal("place"), place: z.string().trim().min(1) }),
  z.strictObject({
    type: z.literal("relation"),
    fromPlace: z.string().trim().min(1),
    toPlace: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal("action"),
    actionId: z.string().min(1),
    place: z.string().trim().min(1).optional(),
    payload: z.string().optional(),
  }),
]);
export const executeActionSchema = z.strictObject({
  actionId: z.string().min(1),
  payload: z.string(),
});
export type InspectWorldInput = z.infer<typeof inspectWorldSchema>;
export type ExecuteActionInput = z.infer<typeof executeActionSchema>;

export type PlaceRef = { placeId: string; name: string };
export type ConditionView = {
  description: string;
  status: "met" | "unmet" | "unknown" | "needs_parameters";
};
export type TravelCost = { money: number; stamina: number; satiety: number };
export type RouteView = {
  routeId: string;
  from: PlaceRef;
  to: PlaceRef;
  kind: "path" | "entrance";
  mode: "walk" | "train";
  durationMinutes: number;
  cost: TravelCost;
  conditions: ConditionView[];
};
/** 通信时间为 Unix 毫秒；移动过程中没有当前地点。 */
export type PositionView =
  | { type: "at_place"; place: PlaceRef; hierarchy: PlaceRef[] }
  | {
      type: "moving";
      activityId: string;
      routeId: string;
      from: PlaceRef;
      to: PlaceRef;
      startedAt: number;
      endsAt: number;
    };
export type Direction =
  | "east"
  | "northeast"
  | "north"
  | "northwest"
  | "west"
  | "southwest"
  | "south"
  | "southeast";
export type SpatialRelationView =
  | { type: "same_place" | "contains" | "inside" }
  | { type: "direction"; direction: Direction; map: PlaceRef; from: PlaceRef; to: PlaceRef }
  | { type: "overlapping_position"; map: PlaceRef; from: PlaceRef; to: PlaceRef };
export type RoutePathView =
  | { status: "same_place" | "no_known_path" }
  | { status: "found"; steps: RouteView[]; totalDurationMinutes: number; totalCost: TravelCost };
export type ActionSummary = { actionId: string; description: string };
export type ActivityView = {
  activityId: string;
  actionId: string;
  startedAt: number;
  endsAt: number;
};
export type ItemView = { itemId: string; name: string; quantity: number };
export type ObservationView =
  | { status: "not_observed" }
  | {
      status: "observed";
      weather: string;
      isOpen: boolean;
      characters: { characterId: string; name: string }[];
      resources: ItemView[];
    };
export type InspectWorldResult =
  | {
      type: "places";
      places: { place: PlaceRef; hierarchy: PlaceRef[]; description: string }[];
    }
  | {
      type: "current";
      now: number;
      position: PositionView;
      activity: ActivityView | null;
      body: { stamina: number; satiety: number };
      money: number;
      phoneBattery: number;
      inventory: ItemView[];
      routes: RouteView[];
      actions: ActionSummary[];
      observation: ObservationView;
    }
  | {
      type: "place";
      place: PlaceRef;
      hierarchy: PlaceRef[];
      description: string;
      /** 常规开放时段（当地整点、左闭右开）；null 表示全天开放。 */
      openingHours: readonly [number, number] | null;
      children: PlaceRef[];
      routes: RouteView[];
      actions: ActionSummary[];
      observation: ObservationView;
    }
  | {
      type: "relation";
      from: PlaceRef;
      to: PlaceRef;
      spatial: SpatialRelationView;
      directRoutes: RouteView[];
      path: RoutePathView;
    }
  | {
      type: "action";
      actionId: string;
      /** 本次查询采用的地点；移动中查询通用行动时为 null。 */
      place: PlaceRef | null;
      description: string;
      payloadSchema: Record<string, unknown>;
      options: JsonValue[];
      conditions: ConditionView[];
      durationDescription: string;
    };

export type WorldErrorCode =
  | "invalid_request"
  | "invalid_payload"
  | "character_not_found"
  | "place_not_known"
  | "place_ambiguous"
  | "place_required"
  | "action_not_available"
  | "route_not_known"
  | "conditions_not_met"
  | "request_conflict"
  | "world_unavailable";
export type WorldFailure = {
  ok: false;
  code: WorldErrorCode;
  message: string;
  conditions?: ConditionView[];
};
export type WorldResult<T> = { ok: true; value: T } | WorldFailure;
export type ExecuteActionResult = {
  status: "started" | "completed";
  activity: ActivityView;
  description: string;
};

/** 接收确认只说明事件已进入角色的持久化输入队列。 */
export type WorldEvent = {
  eventId: string;
  occurredAt: number;
  characterId: string;
  type: "activity_started" | "activity_completed" | "weather_changed";
  description: string;
  activity: ActivityView | null;
  position: PositionView;
  /** 到达时保存的现场感知；不在重连投递时重新查询。 */
  observation?: ObservationView;
};
export type WorldServerMessage =
  | { type: "event"; deliveryId: string; event: WorldEvent }
  | { type: "ready"; current: Extract<InspectWorldResult, { type: "current" }> }
  | { type: "error"; error: WorldFailure };
export const worldClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("subscribe"),
    characterId: z.string().min(1),
    eventTypes: z.array(z.enum(["activity_started", "activity_completed", "weather_changed"])),
  }),
  z.strictObject({ type: z.literal("ack"), deliveryId: z.string().regex(/^\d+$/) }),
]);

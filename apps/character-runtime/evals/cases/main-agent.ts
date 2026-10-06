import { places } from "../../../world-simulator/src/content/locations";
import { isPlaceOpen } from "../../../world-simulator/src/environment/places";
import { weatherPeriod } from "../../../world-simulator/src/environment/weather";
import type { WorldState } from "../../../world-simulator/src/state";
import type { CharacterEvent } from "../../src/agent-loop/events";
import type { EvaluationCase } from "../report";

export type MainAgentCase = EvaluationCase & {
  event: CharacterEvent;
  /** 世界初始状态；地点、路线、熟悉范围及行动规则使用正式定义。 */
  world: WorldState;
  timezone: string;
  unavailable: boolean;
};

const time = "2026-10-06T18:00:00+08:00";
const now = new Date(time).getTime();
const timezone = "Asia/Shanghai";
/** 固定场景：完整小镇，角色在屋内且饱腹很低，背包中有一份百奇。 */
const world: WorldState = {
  weather: { type: "晴", temperatureLevel: "舒适" },
  weatherPeriod: weatherPeriod(now, timezone),
  resourceDate: "2026-10-06",
  places: Object.fromEntries(
    places.map((place) => [
      place.id,
      {
        resources: {},
        closed: false,
        isOpen: isPlaceOpen(place.id, now, timezone, false),
      },
    ]),
  ),
  characters: {
    yuuno: {
      characterId: "yuuno",
      placeId: "home_interior",
      stamina: 80,
      satiety: 10,
      money: 100,
      phoneBattery: 90,
      inventory: { 百奇: 1 },
      currentActivity: null,
    },
  },
};

export const mainAgentCases: MainAgentCase[] = [
  {
    id: "main-choose-action",
    title: "主 loop · 在家饥饿，背包有食物",
    time,
    event: { id: "connected-1", type: "connected", occurredAt: now },
    world,
    timezone,
    unavailable: false,
  },
  {
    id: "main-active-activity",
    title: "主 loop · 活动仍在进行",
    time,
    event: {
      id: "due-1",
      type: "activity_due",
      activityId: "existing-activity",
      endsAt: now - 600_000,
      occurredAt: now,
    },
    world: {
      ...world,
      characters: {
        yuuno: {
          ...world.characters.yuuno,
          inventory: {},
          currentActivity: {
            activityId: "existing-activity",
            actionId: "吃东西",
            payload: { items: [{ itemId: "百奇", quantity: 1 }] },
            startedAt: now - 1_800_000,
            endsAt: now + 300_000,
            settlement: { stamina: 10, satiety: 5, description: "百奇 1 份" },
          },
        },
      },
    },
    timezone,
    unavailable: false,
  },
  {
    id: "main-world-unavailable",
    title: "主 loop · 超时检查时世界不可用",
    time,
    event: {
      id: "due-2",
      type: "activity_due",
      activityId: "unknown-activity",
      endsAt: now - 600_000,
      occurredAt: now,
    },
    world,
    timezone,
    unavailable: true,
  },
];

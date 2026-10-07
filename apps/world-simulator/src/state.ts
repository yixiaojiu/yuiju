import type { ActivityView, JsonObject } from "@yuiju/shared/world/protocol";
import type { TemperatureLevel, WeatherType } from "./environment/weather";

/** 活动持久化开始时确定的结算依据；重启不重新选择或计算时长。 */
export type RunningActivity = ActivityView & {
  payload: JsonObject;
  settlement: JsonObject;
  /** 仅空闲发呆使用；未设置表示尚未提醒，首次从 startedAt 计算十分钟。 */
  lastReminderAt?: number;
};
export type WorldCharacterState = {
  characterId: string;
  placeId: string | null;
  stamina: number;
  satiety: number;
  money: number;
  phoneBattery: number;
  inventory: Record<string, number>;
  /** 正常流程始终有活动；恢复或 tick 遇到空值时，由世界补为空闲发呆。 */
  currentActivity: RunningActivity | null;
};
export type PlaceState = {
  resources: Record<string, number>;
  /** 临时关闭标记，独立于常规营业时间。 */
  closed: boolean;
  /** 由 PlaceEvolution 维护的实际开放状态，查询不再重新计算。 */
  isOpen: boolean;
};
export type WeatherState = { type: WeatherType; temperatureLevel: TemperatureLevel };
export type WorldState = {
  weather: WeatherState;
  weatherPeriod: number;
  resourceDate: string;
  places: Record<string, PlaceState>;
  characters: Record<string, WorldCharacterState>;
};

/** 身体值的业务范围是 0～100，收益溢出不产生额外储备。 */
export function changeBody(character: WorldCharacterState, stamina: number, satiety: number): void {
  character.stamina = Math.max(0, Math.min(100, character.stamina + stamina));
  character.satiety = Math.max(0, Math.min(100, character.satiety + satiety));
}

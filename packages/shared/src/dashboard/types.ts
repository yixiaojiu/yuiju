import type { ActivityView, ItemView, PositionView } from "../world/protocol";

/** 世界生成的只读展示投影；地点名称由世界解析，dashboard 不复制地图规则。 */
export type WorldStatus = {
  updatedAt: number;
  position: PositionView;
  activity: ActivityView | null;
  stamina: number;
  satiety: number;
  money: number;
  phoneBattery: number;
  inventory: ItemView[];
  weather: string | null;
};
/** 可公开的世界环境展示数据，不包含角色通知、收件箱或活动等待。 */
export type WorldEnvironmentStatus = {
  updatedAt: number;
  weather: { type: string; temperatureLevel: string };
  weatherPeriod: number;
  resourceDate: string;
  places: {
    id: string;
    name: string;
    isOpen: boolean;
    closed: boolean;
    resources: { name: string; quantity: number }[];
  }[];
};
export type EmotionStatus = {
  pleasure: number;
  activation: number;
  control: number;
  updatedAt: number;
};
/** 公开历史只包含事实正文，不复制通知收件人或内部结算状态。 */
export type ActivityRecord = {
  eventId: string;
  characterId: string | null;
  occurredAt: number;
  type: "activity_started" | "activity_completed" | "weather_changed";
  activity: ActivityView | null;
  description: string;
};
export type ExperienceDocument = {
  id: string;
  characterId: string;
  grain: "day" | "week" | "month" | "year";
  startDate: string;
  endDate: string;
  text: string;
};

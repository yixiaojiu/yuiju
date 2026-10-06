import { worldTime } from "../environment/time";
import type { ActionCondition } from "./definition";

export const daytime: ActionCondition = {
  description: "时间在 06:00 至 22:00 之间",
  check: ({ now, timezone }) => {
    const hour = worldTime(now, timezone).hour();
    return hour >= 6 && hour < 22 ? "met" : "unmet";
  },
};
export const weekdayMorning: ActionCondition = {
  description: "工作日的上午（06:00 至 12:00）",
  check: ({ now, timezone }) => {
    const time = worldTime(now, timezone);
    return time.day() >= 1 && time.day() <= 5 && time.hour() >= 6 && time.hour() < 12
      ? "met"
      : "unmet";
  },
};
export const afternoon: ActionCondition = {
  description: "时间在 12:00 至 18:00 之间",
  check: ({ now, timezone }) => {
    const hour = worldTime(now, timezone).hour();
    return hour >= 12 && hour < 18 ? "met" : "unmet";
  },
};
export function minimumStamina(value: number): ActionCondition {
  return {
    description: `体力至少为 ${value}`,
    check: ({ character }) => (character.stamina >= value ? "met" : "unmet"),
  };
}
export function minimumMoney(value: number): ActionCondition {
  return {
    description: `金币至少为 ${value}`,
    check: ({ character }) => (character.money >= value ? "met" : "unmet"),
  };
}

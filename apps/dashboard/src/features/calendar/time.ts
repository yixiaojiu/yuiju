import type { CalendarQuery } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);
export function calendarDate(date: string, offset: number): string {
  return dayjs.utc(date).add(offset, "day").format("YYYY-MM-DD");
}
export function calendarWeek(date: string): string {
  const weekday = dayjs.utc(date).day();
  return calendarDate(date, -(weekday === 0 ? 6 : weekday - 1));
}
export function calendarRange(date: string, days: number, timezone: string) {
  return {
    from: dayjs.tz(date, timezone).valueOf(),
    to: dayjs.tz(calendarDate(date, days), timezone).valueOf(),
  };
}
export function calendarQueryUrl(characterId: string, query: CalendarQuery): string {
  return `/api/calendar?${new URLSearchParams({ characterId, query: JSON.stringify(query) })}`;
}
export const calendarStatusLabels = {
  scheduled: "已安排",
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  expired: "已失效",
};
export function calendarTime(timestamp: number, timezone: string, includeDate = false): string {
  return dayjs(timestamp)
    .tz(timezone)
    .format(includeDate ? "MM-DD HH:mm" : "HH:mm");
}

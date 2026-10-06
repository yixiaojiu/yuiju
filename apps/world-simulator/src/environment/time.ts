import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/** 世界规则统一使用项目时区；状态里的时间仍为绝对毫秒。 */
export function worldTime(timestamp: number, timezone: string) {
  return dayjs(timestamp).tz(timezone);
}

/** 从当地日历日期构造时刻，避免跨 DST 时沿用前一天的 UTC 偏移。 */
export function localTimestamp(
  date: string,
  hour: number,
  minute: number,
  timezone: string,
): number {
  return dayjs
    .tz(`${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, timezone)
    .valueOf();
}

import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/**
 * 为 LLM 展示时间，固定使用 `YYYY-MM-DD HH:mm 周几`，采用 24 小时制。
 * @param value Unix 毫秒时间戳或 Date 对象。
 * @param timezone 项目配置的 app.timezone，例如 Asia/Shanghai。
 * @returns 例如 `2026-10-01 14:30 周四`；不改变原始时间点。
 */
export function formatLlmDateTime(value: number | Date, timezone: string): string {
  return dayjs(value).tz(timezone).locale("zh-cn").format("YYYY-MM-DD HH:mm ddd");
}

import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

/** 在浏览器中按本地时区展示时间。 */
export function formatTime(value: number | string, date = false) {
  return dayjs(value).format(date ? "YYYY-MM-DD HH:mm" : "HH:mm");
}

/** 查询日期沿用项目时区，与服务端自然日范围保持一致。 */
export function today(timezone: string) {
  return dayjs().tz(timezone).format("YYYY-MM-DD");
}

import type { CalendarItem } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import { createCalendarItem } from "../calendar/calendar";
import { localTimestamp, worldTime } from "../environment/time";

/** 每位学生只登记两条规则，初始化标记不随课程清理而删除。 */
export function createSchoolCalendar(
  characterId: string,
  now: number,
  timezone: string,
): CalendarItem[] {
  let date = dayjs.utc(worldTime(now, timezone).format("YYYY-MM-DD"));
  while (date.day() === 0 || date.day() === 6) {
    date = date.add(1, "day");
  }
  return [
    { key: "morning", title: "上午课程", start: 9, end: 12 },
    { key: "afternoon", title: "下午课程", start: 14, end: 16 },
  ].map(({ key, title, start, end }) =>
    createCalendarItem(
      characterId,
      `school:${encodeURIComponent(characterId)}:${key}`,
      {
        kind: "event",
        title,
        description: `工作日${title}，在学校上课`,
        startAt: localTimestamp(date.format("YYYY-MM-DD"), start, 0, timezone),
        endAt: localTimestamp(date.format("YYYY-MM-DD"), end, 0, timezone),
        repeatWeekdays: [1, 2, 3, 4, 5],
        remindBeforeStartMinutes: 0,
      },
      now,
      timezone,
    ),
  );
}

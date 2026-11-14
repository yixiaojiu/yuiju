import type { CalendarEvent, CalendarOccurrence } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import { localTimestamp, worldTime } from "../environment/time";

/** 按当地日期展开，仅返回与区间相交且完整位于有效期内的实例。 */
export function calendarOccurrences(
  event: CalendarEvent,
  from: number,
  to: number,
  timezone: string,
): CalendarOccurrence[] {
  if (event.repeatWeekdays === null) {
    return event.startAt < to && event.endAt > from && event.endAt <= event.deleteAt
      ? [{ ...event, occurrenceId: `${event.id}@${event.startAt}` }]
      : [];
  }
  const start = worldTime(event.startAt, timezone);
  const end = worldTime(event.endAt, timezone);
  const dayOffset = dayjs
    .utc(end.format("YYYY-MM-DD"))
    .diff(dayjs.utc(start.format("YYYY-MM-DD")), "day");
  const first = Math.max(event.startAt, from - (dayOffset + 1) * 86_400_000);
  const until = Math.min(to, event.repeatUntilAt!, event.deleteAt);
  const result: CalendarOccurrence[] = [];
  for (
    let date = dayjs.utc(worldTime(first, timezone).format("YYYY-MM-DD"));
    date.format("YYYY-MM-DD") <= worldTime(until, timezone).format("YYYY-MM-DD");
    date = date.add(1, "day")
  ) {
    const weekday = date.day() === 0 ? 7 : date.day();
    if (!event.repeatWeekdays.includes(weekday)) {
      continue;
    }
    const startAt = localTimestamp(
      date.format("YYYY-MM-DD"),
      start.hour(),
      start.minute(),
      timezone,
    );
    const endAt = localTimestamp(
      date.add(dayOffset, "day").format("YYYY-MM-DD"),
      end.hour(),
      end.minute(),
      timezone,
    );
    if (
      startAt >= event.startAt &&
      startAt < to &&
      endAt > from &&
      endAt <= event.repeatUntilAt! &&
      endAt <= event.deleteAt
    ) {
      result.push({ ...event, startAt, endAt, occurrenceId: `${event.id}@${startAt}` });
    }
  }
  return result;
}

/** 提醒游标仅记录实例开始时刻，不随标题或描述修改重置。 */
export function nextEventReminder(
  event: CalendarEvent,
  handledStartAt: number | null,
  now: number,
  timezone: string,
): { at: number; startAt: number; endAt: number } | null {
  if (
    event.status !== "scheduled" ||
    event.remindBeforeStartMinutes === null ||
    event.deleteAt <= now
  ) {
    return null;
  }
  const until = event.repeatUntilAt === null ? event.endAt : event.repeatUntilAt;
  for (const occurrence of calendarOccurrences(event, now, until, timezone)) {
    if (handledStartAt !== null && occurrence.startAt <= handledStartAt) {
      continue;
    }
    return {
      at: occurrence.startAt - event.remindBeforeStartMinutes * 60_000,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
    };
  }
  return null;
}

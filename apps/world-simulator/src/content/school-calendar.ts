import type { CalendarItem } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import { createCalendarItem } from "../calendar/calendar";
import { localTimestamp, worldTime } from "../environment/time";

/**
 * 每节课的上下课时刻（当地时间，0 点起算的分钟数）；课间与午休留给角色自行安排。
 * 上午第一节提前到出门前提醒，午休后第一节留出从食堂返回的时间，其余课节不提醒。
 */
export const schoolPeriods = [
  { start: 8 * 60 + 50, end: 9 * 60 + 35, remindBeforeStartMinutes: 40 },
  { start: 9 * 60 + 50, end: 10 * 60 + 35, remindBeforeStartMinutes: null },
  { start: 10 * 60 + 50, end: 11 * 60 + 35, remindBeforeStartMinutes: null },
  { start: 11 * 60 + 50, end: 12 * 60 + 35, remindBeforeStartMinutes: null },
  { start: 13 * 60 + 40, end: 14 * 60 + 25, remindBeforeStartMinutes: 15 },
];
/** 周课表按星期（1 = 周一）列出各节科目，每周重复；周三只上半天。 */
export const schoolTimetable: Readonly<Record<number, readonly string[]>> = {
  1: ["国语", "数学", "英语", "历史", "理科"],
  2: ["数学", "英语", "理科", "体育", "国语"],
  3: ["英语", "国语", "数学", "音乐"],
  4: ["数学", "理科", "历史", "英语", "体育"],
  5: ["国语", "英语", "数学", "理科", "班会"],
};

/** 当前所在课节；周末、课间、午休和放学后返回 null。学习行动与日程共用同一份课表。 */
export function currentSchoolPeriod(now: number, timezone: string) {
  const time = worldTime(now, timezone);
  const minute = time.hour() * 60 + time.minute();
  const subjects = schoolTimetable[time.day()];
  const index = schoolPeriods.findIndex((period) => minute >= period.start && minute < period.end);
  if (subjects === undefined || index === -1 || index >= subjects.length) {
    return null;
  }
  const end = schoolPeriods[index].end;
  return {
    subject: subjects[index],
    endAt: localTimestamp(time.format("YYYY-MM-DD"), Math.floor(end / 60), end % 60, timezone),
  };
}

/** 每位学生按“星期 × 课节”各登记一条世界维护的长期日程；角色只能查看，不会到期。 */
export function createSchoolCalendar(
  characterId: string,
  now: number,
  timezone: string,
): CalendarItem[] {
  const today = dayjs.utc(worldTime(now, timezone).format("YYYY-MM-DD"));
  return Object.entries(schoolTimetable).flatMap(([weekdayText, subjects]) => {
    const weekday = Number(weekdayText);
    // 重复规则的锚点必须落在所属星期，取今天起最近的一个该星期日期。
    const date = today.add((weekday - today.day() + 7) % 7, "day").format("YYYY-MM-DD");
    return subjects.map((subject, index) => {
      const { start, end, remindBeforeStartMinutes } = schoolPeriods[index];
      return createCalendarItem(
        characterId,
        `school:${encodeURIComponent(characterId)}:${weekday}:${index + 1}`,
        {
          kind: "event",
          title: `${subject}课`,
          description: `星见丘高校第 ${index + 1} 节，${subject}`,
          startAt: localTimestamp(date, Math.floor(start / 60), start % 60, timezone),
          endAt: localTimestamp(date, Math.floor(end / 60), end % 60, timezone),
          repeatWeekdays: [weekday],
          remindBeforeStartMinutes,
        },
        "system",
        now,
        timezone,
      );
    });
  });
}

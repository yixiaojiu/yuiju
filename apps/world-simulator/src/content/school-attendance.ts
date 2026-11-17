import { worldTime } from "../environment/time";
import type { WorldCharacterState } from "../state";
import { schoolPeriods, schoolTimetable } from "./school-calendar";

/** 上课开始后这么久仍不在上这节课，记为缺勤。 */
const lateToleranceMinutes = 15;
export const studyActionId = "在学校学习";

/**
 * 只按实时推进的当前时刻检查；停机期间已经结束的课节记为已检查，不判缺勤。
 * 修改角色的出勤检查进度，返回本次需要通知角色的缺勤描述。
 */
export function checkSchoolAttendance(
  character: WorldCharacterState,
  now: number,
  timezone: string,
): string[] {
  const time = worldTime(now, timezone);
  const date = time.format("YYYY-MM-DD");
  const minute = time.hour() * 60 + time.minute();
  if (character.school.date !== date) {
    character.school = { date, checkedPeriods: [] };
  }
  const subjects = schoolTimetable[time.day()];
  if (subjects === undefined) {
    return [];
  }
  const notices: string[] = [];
  for (const [index, subject] of subjects.entries()) {
    const period = schoolPeriods[index];
    if (
      minute < period.start + lateToleranceMinutes ||
      character.school.checkedPeriods.includes(index)
    ) {
      continue;
    }
    character.school.checkedPeriods.push(index);
    if (minute >= period.end || character.currentActivity!.actionId === studyActionId) {
      continue;
    }
    notices.push(
      `第 ${index + 1} 节${subject}课已经开始一段时间了，你没有在上课，老师点名时记下了你的缺席。`,
    );
  }
  return notices;
}

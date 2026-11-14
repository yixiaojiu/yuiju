import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import {
  calendarQuerySchema,
  calendarStatusSchema,
  calendarWriteSchema,
} from "@yuiju/shared/world/calendar";
import { tool } from "ai";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { queryWorldCalendar, type WorldClient } from "./client";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
const localTime = z.string().describe("你填写项目时区的 YYYY-MM-DD HH:mm 时间");
const content = { title: z.string().min(1), description: z.string() };
const eventFields = {
  ...content,
  startAt: localTime,
  endAt: localTime,
  repeatWeekdays: z.array(z.number().int().min(1).max(7)).min(1).nullable(),
  remindBeforeStartMinutes: z.number().int().nonnegative().nullable(),
};
const taskFields = {
  ...content,
  plannedAt: localTime.nullable(),
  dueAt: localTime.nullable(),
  attentionAt: localTime.nullable(),
};
const eventChanges = z
  .strictObject({ ...eventFields, status: z.enum(["scheduled", "cancelled"]) })
  .partial();
const taskChanges = z
  .strictObject({
    ...taskFields,
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    progress: z.string(),
  })
  .partial();
const changes = z
  .union([eventChanges, taskChanges])
  .refine((value) => Object.keys(value).length > 0, "至少修改一个字段");
const localWrite = z.union([
  z.strictObject({ operation: z.literal("create"), kind: z.literal("event"), ...eventFields }),
  z.strictObject({ operation: z.literal("create"), kind: z.literal("task"), ...taskFields }),
  z.strictObject({
    operation: z.literal("update"),
    itemId: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    changes,
  }),
]);
export const writeCalendarToolSchema = z
  .strictObject({
    operation: z
      .enum(["create", "update"])
      .describe("你创建时提供 kind 及该类型完整字段；更新只提供 itemId、expectedRevision、changes"),
    kind: z.enum(["event", "task"]).optional(),
    title: content.title.optional(),
    description: content.description.optional(),
    startAt: localTime.optional(),
    endAt: localTime.optional(),
    repeatWeekdays: eventFields.repeatWeekdays.optional(),
    remindBeforeStartMinutes: eventFields.remindBeforeStartMinutes.optional(),
    plannedAt: taskFields.plannedAt.optional(),
    dueAt: taskFields.dueAt.optional(),
    attentionAt: taskFields.attentionAt.optional(),
    itemId: z.string().optional(),
    expectedRevision: z.number().int().positive().optional(),
    changes: changes.optional(),
  })
  .pipe(localWrite);
export const queryCalendarToolSchema = z
  .strictObject({
    type: z
      .enum(["range", "tasks", "item"])
      .describe(
        "你查询 range 时传 from、to、statuses，可选 kind；tasks 传 statuses；item 传 itemId",
      ),
    from: localTime.optional(),
    to: localTime.optional(),
    kind: z.enum(["event", "task"]).optional(),
    statuses: z.array(calendarStatusSchema).optional(),
    itemId: z.string().optional(),
  })
  .pipe(
    z.discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("range"),
        from: localTime,
        to: localTime,
        statuses: z.array(calendarStatusSchema),
        kind: z.enum(["event", "task"]).optional(),
      }),
      z.strictObject({ type: z.literal("tasks"), statuses: z.array(calendarStatusSchema) }),
      z.strictObject({ type: z.literal("item"), itemId: z.string().min(1) }),
    ]),
  );
export const calendarTools = {
  query_calendar: tool({
    description:
      "你可以查询自己的日程、任务与进展。range 拉取时间范围内的具体日程与任务节点；tasks 可找无时间或逾期任务；item 读取已有定义及版本。安排不是已发生的经历。",
    inputSchema: queryCalendarToolSchema,
  }),
  write_calendar: tool({
    description:
      "你可以创建或更新自己的安排。event 填完整起止时间、repeatWeekdays（单次为 null）、remindBeforeStartMinutes（不提醒为 null）；task 填 plannedAt、dueAt、attentionAt（未安排为 null）。更新填准确 ID、查询版本及 changes，完成或取消通过 status 更新。任务固定有效7天，重复日程30天，不能延长；结束记录7天后清理。时间使用项目时区 YYYY-MM-DD HH:mm。",
    inputSchema: writeCalendarToolSchema,
  }),
};

const timeKeys = new Set([
  "from",
  "to",
  "startAt",
  "endAt",
  "plannedAt",
  "dueAt",
  "attentionAt",
  "createdAt",
  "updatedAt",
  "deleteAt",
  "expiresAt",
  "repeatUntilAt",
  "occurrenceStartAt",
  "occurrenceEndAt",
]);
/** 查询、创建、更新共享完全相同的本地时间契约。 */
function parseTimes(input: Record<string, unknown>, zone: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (key === "changes") {
        return [key, parseTimes(value as Record<string, unknown>, zone)];
      }
      if (timeKeys.has(key) && typeof value === "string") {
        const parsed = dayjs.tz(value, "YYYY-MM-DD HH:mm", zone);
        if (!parsed.isValid() || parsed.format("YYYY-MM-DD HH:mm") !== value) {
          throw new Error(`时间格式无效：${value}，请填写 YYYY-MM-DD HH:mm`);
        }
        return [key, parsed.valueOf()];
      }
      return [key, value];
    }),
  );
}
export function formatCalendarOutput(value: unknown, zone: string): string {
  return JSON.stringify(
    value,
    (key, entry) =>
      timeKeys.has(key) && typeof entry === "number" ? formatLlmDateTime(entry, zone) : entry,
    2,
  );
}
export async function queryCalendarForAgent(
  characterId: string,
  input: z.infer<typeof queryCalendarToolSchema>,
  signal?: AbortSignal,
): Promise<string> {
  const zone = (await load_config()).app!.timezone!;
  const query = calendarQuerySchema.parse(parseTimes(input, zone));
  return formatCalendarOutput(await queryWorldCalendar(characterId, query, signal), zone);
}
export async function writeCalendarForAgent(
  world: WorldClient,
  requestId: string,
  input: unknown,
): Promise<string> {
  const zone = (await load_config()).app!.timezone!;
  const parsed = writeCalendarToolSchema.parse(input);
  const command = calendarWriteSchema.parse(parseTimes(parsed, zone));
  return formatCalendarOutput(await world.writeCalendar(command, requestId), zone);
}

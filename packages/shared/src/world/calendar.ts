import { z } from "zod";

export const calendarStatusSchema = z.enum([
  "scheduled",
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
]);
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;
const time = z.number().int();
const content = { title: z.string().trim().min(1), description: z.string() };
const eventFields = {
  ...content,
  startAt: time,
  endAt: time,
  repeatWeekdays: z.array(z.number().int().min(1).max(7)).min(1).nullable(),
  remindBeforeStartMinutes: z.number().int().nonnegative().nullable(),
};
const taskFields = {
  ...content,
  plannedAt: time.nullable(),
  dueAt: time.nullable(),
  attentionAt: time.nullable(),
};
export const calendarEventInputSchema = z.strictObject({
  kind: z.literal("event"),
  ...eventFields,
});
export const calendarTaskInputSchema = z.strictObject({ kind: z.literal("task"), ...taskFields });
export const calendarCreateSchema = z.discriminatedUnion("kind", [
  calendarEventInputSchema,
  calendarTaskInputSchema,
]);
export const calendarEventChangesSchema = z
  .strictObject({ ...eventFields, status: z.enum(["scheduled", "cancelled"]) })
  .partial();
export const calendarTaskChangesSchema = z
  .strictObject({
    ...taskFields,
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    progress: z.string(),
  })
  .partial();
export const calendarUpdateSchema = z.strictObject({
  itemId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  changes: z
    .union([calendarEventChangesSchema, calendarTaskChangesSchema])
    .refine((value) => Object.keys(value).length > 0, "至少修改一个字段"),
});
export const calendarWriteSchema = z.union([
  calendarEventInputSchema.extend({ operation: z.literal("create") }),
  calendarTaskInputSchema.extend({ operation: z.literal("create") }),
  calendarUpdateSchema.extend({ operation: z.literal("update") }),
]);
export const calendarQuerySchema = z.discriminatedUnion("type", [
  z
    .strictObject({
      type: z.literal("range"),
      from: time,
      to: time,
      kind: z.enum(["event", "task"]).optional(),
      statuses: z.array(calendarStatusSchema),
    })
    .refine((value) => value.from < value.to, "查询开始必须早于结束"),
  z.strictObject({ type: z.literal("tasks"), statuses: z.array(calendarStatusSchema) }),
  z.strictObject({ type: z.literal("item"), itemId: z.string().min(1) }),
]);
export type CalendarCreate = z.infer<typeof calendarCreateSchema>;
export type CalendarUpdate = z.infer<typeof calendarUpdateSchema>;
export type CalendarWrite = z.infer<typeof calendarWriteSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type CalendarBase = {
  id: string;
  characterId: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  deleteAt: number;
};
export type CalendarEvent = CalendarBase &
  z.infer<typeof calendarEventInputSchema> & {
    status: "scheduled" | "cancelled";
    repeatUntilAt: number | null;
  };
export type CalendarTask = CalendarBase &
  z.infer<typeof calendarTaskInputSchema> & {
    status: "pending" | "in_progress" | "completed" | "cancelled" | "expired";
    progress: string;
    expiresAt: number;
  };
export type CalendarItem = CalendarEvent | CalendarTask;
export type CalendarOccurrence = CalendarEvent & { occurrenceId: string };
export type CalendarEntry = CalendarOccurrence | CalendarTask;
export type CalendarQueryResult =
  | { type: "range"; entries: CalendarEntry[] }
  | { type: "tasks"; tasks: CalendarTask[] }
  | { type: "item"; item: CalendarItem };
export type CalendarWriteResult = Pick<
  CalendarBase,
  "id" | "revision" | "createdAt" | "deleteAt"
> & {
  expiresAt: number | null;
  repeatUntilAt: number | null;
};
export type CalendarAttention = {
  itemId: string;
  revision: number;
  attentionAt: number;
  occurrenceStartAt: number | null;
  occurrenceEndAt: number | null;
};

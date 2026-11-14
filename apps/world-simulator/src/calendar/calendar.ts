import { createHash } from "node:crypto";
import {
  type CalendarCreate,
  type CalendarEntry,
  type CalendarItem,
  type CalendarQuery,
  type CalendarQueryResult,
  type CalendarTask,
  type CalendarUpdate,
  type CalendarWrite,
  type CalendarWriteResult,
  calendarEventChangesSchema,
  calendarTaskChangesSchema,
} from "@yuiju/shared/world/calendar";
import type { WorldEvent, WorldResult } from "@yuiju/shared/world/protocol";
import type { WorldEventQueues } from "../queue";
import { calendarOccurrences, nextEventReminder } from "./recurrence";
import {
  type CalendarSave,
  commitCalendar,
  dueCalendarIds,
  readCalendarItem,
  readCalendarItems,
  readCalendarProgress,
  readCalendarReceipt,
} from "./storage";

export const calendarDayMs = 86_400_000;
export const taskLifetimeMs = 7 * calendarDayMs;
export const calendarRetentionMs = 7 * calendarDayMs;
export const repeatLifetimeMs = 30 * calendarDayMs;

export function validateCalendarItem(item: CalendarItem): void {
  if (item.kind === "event") {
    if (item.startAt >= item.endAt) {
      throw new Error("日程开始必须早于结束");
    }
    if (item.endAt > item.deleteAt) {
      throw new Error("日程不能超出已有删除时间");
    }
    if (
      item.repeatWeekdays !== null &&
      new Set(item.repeatWeekdays).size !== item.repeatWeekdays.length
    ) {
      throw new Error("重复星期不能重复");
    }
  } else {
    if (item.plannedAt !== null && item.dueAt !== null && item.plannedAt > item.dueAt) {
      throw new Error("计划开始不能晚于截止时间");
    }
    if (
      [item.plannedAt, item.dueAt, item.attentionAt].some(
        (value) => value !== null && value >= item.expiresAt,
      )
    ) {
      throw new Error("任务时间必须在创建后 7 天有效期内");
    }
  }
}

export function createCalendarItem(
  characterId: string,
  id: string,
  input: CalendarCreate,
  now: number,
  timezone: string,
): CalendarItem {
  const base = {
    id,
    characterId,
    title: input.title,
    description: input.description,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  let item: CalendarItem;
  if (input.kind === "task") {
    item = {
      ...base,
      ...input,
      status: "pending",
      progress: "",
      expiresAt: now + taskLifetimeMs,
      deleteAt: now + taskLifetimeMs + calendarRetentionMs,
    };
  } else {
    const repeatUntilAt = input.repeatWeekdays === null ? null : now + repeatLifetimeMs;
    item = {
      ...base,
      ...input,
      status: "scheduled",
      repeatUntilAt,
      deleteAt: (repeatUntilAt === null ? input.endAt : repeatUntilAt) + calendarRetentionMs,
    };
  }
  validateCalendarItem(item);
  validateEventWeekday(item, timezone);
  return item;
}

function validateEventWeekday(item: CalendarItem, timezone: string): void {
  if (item.kind === "event" && item.repeatWeekdays !== null) {
    if (!calendarOccurrences(item, item.startAt, item.startAt + 1, timezone).length) {
      throw new Error("重复日程的锚点星期必须在规则中，且首个实例须在 30 天有效期内");
    }
  }
}

export function updateCalendarItem(
  previous: CalendarItem,
  input: CalendarUpdate,
  now: number,
  timezone: string,
): CalendarItem {
  if (
    previous.deleteAt <= now ||
    (previous.kind === "task"
      ? previous.expiresAt <= now
      : previous.repeatUntilAt !== null && previous.repeatUntilAt <= now)
  ) {
    throw new Error("事项已失效，不能修改或延长有效期");
  }
  let item: CalendarItem;
  if (previous.kind === "task") {
    const changes = calendarTaskChangesSchema.parse(input.changes);
    item = { ...previous, ...changes };
    if (item.status === "completed" || item.status === "cancelled") {
      item.attentionAt = null;
      item.deleteAt = Math.min(item.deleteAt, now + calendarRetentionMs);
    }
  } else {
    const changes = calendarEventChangesSchema.parse(input.changes);
    item = { ...previous, ...changes };
    if ((previous.repeatWeekdays === null) !== (item.repeatWeekdays === null)) {
      throw new Error("不能切换单次与重复模式");
    }
    if (item.status === "cancelled") {
      item.deleteAt = Math.min(item.deleteAt, now + calendarRetentionMs);
    } else if (item.repeatUntilAt === null) {
      // 普通单次改期可重新计算结束后的保留期；取消后的恢复不延长清理时钟。
      item.deleteAt =
        previous.status === "cancelled" ? previous.deleteAt : item.endAt + calendarRetentionMs;
    }
  }
  item.revision += 1;
  item.updatedAt = now;
  validateCalendarItem(item);
  validateEventWeekday(item, timezone);
  return item;
}

export function selectCalendarItems(
  items: CalendarItem[],
  characterId: string,
  query: CalendarQuery,
  timezone: string,
  now: number,
): CalendarQueryResult | null {
  const visible = items
    .filter((item) => item.characterId === characterId && item.deleteAt > now)
    .map(
      (item): CalendarItem =>
        item.kind === "task" &&
        item.expiresAt <= now &&
        (item.status === "pending" || item.status === "in_progress")
          ? { ...item, status: "expired", attentionAt: null }
          : item,
    );
  if (query.type === "item") {
    const item = visible.find((entry) => entry.id === query.itemId);
    return item ? { type: "item", item } : null;
  }
  if (query.type === "tasks") {
    return {
      type: "tasks",
      tasks: visible
        .filter(
          (item): item is CalendarTask =>
            item.kind === "task" && query.statuses.includes(item.status),
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    };
  }
  const entries: CalendarEntry[] = [];
  const sortTimes = new Map<string, number>();
  for (const item of visible) {
    if (
      !query.statuses.includes(item.status) ||
      (query.kind !== undefined && item.kind !== query.kind)
    ) {
      continue;
    }
    if (item.kind === "event") {
      for (const occurrence of calendarOccurrences(item, query.from, query.to, timezone)) {
        entries.push(occurrence);
        sortTimes.set(occurrence.occurrenceId, occurrence.startAt);
      }
    } else {
      const times = [item.plannedAt, item.dueAt].filter(
        (value): value is number => value !== null && value >= query.from && value < query.to,
      );
      if (times.length) {
        entries.push(item);
        sortTimes.set(item.id, Math.min(...times));
      }
    }
  }
  const key = (item: CalendarEntry) => (item.kind === "event" ? item.occurrenceId : item.id);
  entries.sort(
    (a, b) => sortTimes.get(key(a))! - sortTimes.get(key(b))! || key(a).localeCompare(key(b)),
  );
  return { type: "range", entries };
}

export async function queryCalendar(
  characterId: string,
  query: CalendarQuery,
  timezone: string,
  now: number,
): Promise<WorldResult<CalendarQueryResult>> {
  const items =
    query.type === "item"
      ? [await readCalendarItem(query.itemId)].filter((item): item is CalendarItem => item !== null)
      : await readCalendarItems();
  const result = selectCalendarItems(items, characterId, query, timezone, now);
  return result === null
    ? { ok: false, code: "calendar_item_not_found", message: "事项不存在、已清理或不属于你" }
    : { ok: true, value: result };
}

export async function calendarSave(
  item: CalendarItem,
  now: number,
  timezone: string,
  handledStartAt?: number | null,
): Promise<CalendarSave> {
  if (item.kind === "task") {
    return {
      item,
      attentionAt:
        item.status === "pending" || item.status === "in_progress" ? item.attentionAt : null,
      progress: null,
    };
  }
  const handled =
    handledStartAt === undefined
      ? (await readCalendarProgress(item.id)).lastHandledStartAt
      : handledStartAt;
  const next = nextEventReminder(item, handled, now, timezone);
  return {
    item,
    attentionAt: next === null ? null : next.at,
    progress: { revision: item.revision, lastHandledStartAt: handled },
  };
}

export async function writeCalendar(
  queues: WorldEventQueues,
  characterId: string,
  requestId: string,
  input: CalendarWrite,
  now: number,
  timezone: string,
): Promise<WorldResult<CalendarWriteResult>> {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const receipt = await readCalendarReceipt(characterId, requestId);
  if (receipt !== null) {
    return receipt.digest === digest
      ? { ok: true, value: receipt.result }
      : { ok: false, code: "request_conflict", message: "同一请求 ID 不能更换命令内容" };
  }
  let item: CalendarItem;
  if (input.operation === "create") {
    const id = `calendar:${encodeURIComponent(characterId)}:${encodeURIComponent(requestId)}`;
    if (await readCalendarItem(id)) {
      return { ok: false, code: "request_conflict", message: "事项已经存在" };
    }
    const { operation: _operation, ...fields } = input;
    try {
      item = createCalendarItem(characterId, id, fields, now, timezone);
    } catch (error) {
      return { ok: false, code: "invalid_request", message: (error as Error).message };
    }
  } else {
    const previous = await readCalendarItem(input.itemId);
    if (previous === null || previous.characterId !== characterId || previous.deleteAt <= now) {
      return {
        ok: false,
        code: "calendar_item_not_found",
        message: "事项不存在、已清理或不属于你",
      };
    }
    if (previous.revision !== input.expectedRevision) {
      return { ok: false, code: "request_conflict", message: "事项已变化，请重新读取后决定" };
    }
    try {
      item = updateCalendarItem(previous, input, now, timezone);
    } catch (error) {
      return { ok: false, code: "invalid_request", message: (error as Error).message };
    }
  }
  const result: CalendarWriteResult = {
    id: item.id,
    revision: item.revision,
    createdAt: item.createdAt,
    deleteAt: item.deleteAt,
    expiresAt: item.kind === "task" ? item.expiresAt : null,
    repeatUntilAt: item.kind === "event" ? item.repeatUntilAt : null,
  };
  const save = await calendarSave(
    item,
    now,
    timezone,
    input.operation === "create" ? null : undefined,
  );
  await commitCalendar(queues, now, {
    saves: [save],
    removals: [],
    notifications: [],
    receipt: { characterId, requestId, value: { digest, result } },
  });
  return { ok: true, value: result };
}

/** 有效期、删除和提醒都由世界程序推进，处理旧通知不需要模型参与。 */
export async function advanceCalendar(
  queues: WorldEventQueues,
  now: number,
  timezone: string,
  createNotification: (
    item: CalendarItem,
    attention: { at: number; startAt: number | null; endAt: number | null },
  ) => WorldEvent,
): Promise<void> {
  for (const id of await dueCalendarIds("expiry", now)) {
    const previous = await readCalendarItem(id);
    if (previous === null) {
      throw new Error(`日历失效索引缺少正文：${id}`);
    }
    const item: CalendarItem =
      previous.kind === "task" &&
      (previous.status === "pending" || previous.status === "in_progress")
        ? {
            ...previous,
            status: "expired",
            attentionAt: null,
            revision: previous.revision + 1,
            updatedAt: now,
          }
        : previous;
    await commitCalendar(queues, now, {
      saves: [await calendarSave(item, now, timezone)],
      removals: [],
      notifications: [],
    });
  }
  const removals = await dueCalendarIds("cleanup", now);
  if (removals.length) {
    await commitCalendar(queues, now, { saves: [], removals, notifications: [] });
  }
  for (const id of await dueCalendarIds("attention", now)) {
    const item = await readCalendarItem(id);
    if (item === null) {
      throw new Error(`日历关注索引缺少正文：${id}`);
    }
    if (item.kind === "task") {
      const notification = createNotification(item, {
        at: item.attentionAt!,
        startAt: null,
        endAt: null,
      });
      await commitCalendar(queues, now, {
        saves: [await calendarSave({ ...item, attentionAt: null }, now, timezone)],
        removals: [],
        notifications: [notification],
      });
    } else {
      const progress = await readCalendarProgress(id);
      const next = nextEventReminder(item, progress.lastHandledStartAt, now, timezone);
      if (next !== null && next.at <= now) {
        await commitCalendar(queues, now, {
          saves: [await calendarSave(item, now, timezone, next.startAt)],
          removals: [],
          notifications: [createNotification(item, next)],
        });
      } else {
        // 离线错过的实例不补发；重新排到尚未结束的当前实例或下次实例。
        await commitCalendar(queues, now, {
          saves: [await calendarSave(item, now, timezone)],
          removals: [],
          notifications: [],
        });
      }
    }
  }
}

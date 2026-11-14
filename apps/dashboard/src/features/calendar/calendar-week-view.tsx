"use client";

import type { CalendarEntry, CalendarOccurrence } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import { calendarDate, calendarRange, calendarStatusLabels, calendarTime } from "./time";

export type EventSegment = {
  event: CalendarOccurrence;
  top: number;
  height: number;
  lane: number;
  lanes: number;
};
/** 按相交簇分栏；坐标只由当前页面数据派生，不写回日程。 */
export function layoutDayEvents(
  events: CalendarOccurrence[],
  date: string,
  timezone: string,
): EventSegment[] {
  const { from, to } = calendarRange(date, 1, timezone);
  const visible = events
    .filter((event) => event.startAt < to && event.endAt > from)
    .sort((a, b) => a.startAt - b.startAt || a.occurrenceId.localeCompare(b.occurrenceId));
  const result: EventSegment[] = [];
  let cluster: EventSegment[] = [];
  let clusterEnd = from;
  let laneEnds: number[] = [];
  for (const event of visible) {
    const start = Math.max(from, event.startAt);
    const end = Math.min(to, event.endAt);
    if (start >= clusterEnd) {
      for (const segment of cluster) {
        segment.lanes = laneEnds.length;
      }
      result.push(...cluster);
      cluster = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((value) => value <= start);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = end;
    clusterEnd = Math.max(clusterEnd, end);
    const startTime = dayjs(start).tz(timezone);
    const endTime = dayjs(end).tz(timezone);
    const top = startTime.hour() * 60 + startTime.minute();
    const bottom = end === to ? 1440 : endTime.hour() * 60 + endTime.minute();
    cluster.push({ event, top, height: bottom - top, lane, lanes: 0 });
  }
  for (const segment of cluster) {
    segment.lanes = laneEnds.length;
  }
  return [...result, ...cluster];
}

export function CalendarWeekView({
  entries,
  week,
  timezone,
  now,
  onSelect,
}: {
  entries: CalendarEntry[];
  week: string;
  timezone: string;
  now: number;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const dates = Array.from({ length: 7 }, (_, index) => calendarDate(week, index));
  const events = entries.filter((entry): entry is CalendarOccurrence => entry.kind === "event");
  const today = dayjs(now).tz(timezone).format("YYYY-MM-DD");
  return (
    <div className="max-h-[75vh] overflow-auto rounded-2xl border bg-card">
      <div className="min-w-[980px]">
        <div className="sticky top-0 z-20 grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-card">
          <div className="p-2 text-xs text-muted-foreground">时间</div>
          {dates.map((date, index) => (
            <div
              key={date}
              className={`border-l p-2 text-center text-sm ${date === today ? "bg-primary/10 font-bold text-primary" : ""}`}
            >
              <div>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index]}</div>
              <div className="text-xs">{date.slice(5)}</div>
            </div>
          ))}
          <div className="border-t p-2 text-xs text-muted-foreground">任务节点</div>
          {dates.map((date) => {
            const { from, to } = calendarRange(date, 1, timezone);
            return (
              <div key={date} className="space-y-1 border-t border-l p-1">
                {entries
                  .filter((entry) => entry.kind === "task")
                  .flatMap((task) =>
                    [
                      { label: "开始", at: task.plannedAt },
                      { label: "截止", at: task.dueAt },
                    ]
                      .filter(({ at }) => at !== null && at >= from && at < to)
                      .map(({ label, at }) => (
                        <button
                          type="button"
                          key={`${task.id}:${label}`}
                          onClick={() => onSelect(task)}
                          className={`block w-full rounded border border-amber-300 bg-amber-50 p-1 text-left text-xs text-amber-950 focus-visible:ring-2 focus-visible:ring-ring dark:bg-amber-950 dark:text-amber-100 ${task.status === "completed" || task.status === "cancelled" ? "line-through opacity-60" : task.status === "expired" ? "opacity-60" : ""}`}
                        >
                          {calendarTime(at!, timezone)} {label} · {task.title} ·{" "}
                          {calendarStatusLabels[task.status]}
                        </button>
                      )),
                  )}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
          <div className="relative h-[1440px] text-xs text-muted-foreground">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="absolute right-2" style={{ top: hour * 60 }}>
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {dates.map((date) => (
            <div
              key={date}
              className={`relative h-[1440px] border-l ${date === today ? "bg-primary/[0.025]" : ""}`}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t"
                  style={{ top: hour * 60 }}
                />
              ))}
              {layoutDayEvents(events, date, timezone).map(
                ({ event, top, height, lane, lanes }) => (
                  <button
                    type="button"
                    key={event.occurrenceId}
                    onClick={() => onSelect(event)}
                    title={`${event.title} ${calendarTime(event.startAt, timezone, true)}–${calendarTime(event.endAt, timezone, true)}`}
                    className={`absolute overflow-hidden rounded-lg border p-1 text-left text-xs focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring ${event.status === "cancelled" ? "border-border bg-muted text-muted-foreground line-through" : "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"}`}
                    style={{
                      top,
                      height: Math.max(6, height),
                      left: `calc(${(lane * 100) / lanes}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                  >
                    <div className="font-semibold">{event.title}</div>
                    <div>
                      {calendarTime(event.startAt, timezone)}–{calendarTime(event.endAt, timezone)}
                    </div>
                    <p className="mt-1 line-clamp-3">{event.description}</p>
                  </button>
                ),
              )}
              {date === today && (
                <div
                  role="img"
                  aria-label="当前时间"
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                  style={{
                    top: dayjs(now).tz(timezone).hour() * 60 + dayjs(now).tz(timezone).minute(),
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

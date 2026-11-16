"use client";

import { cn } from "@yuiju/shared/ui/utils";
import type { CalendarEntry, CalendarOccurrence } from "@yuiju/shared/world/calendar";
import dayjs from "dayjs";
import { Flag, Play } from "lucide-react";
import {
  calendarDate,
  calendarRange,
  calendarStatusLabels,
  calendarTime,
  calendarWeek,
} from "./time";

/** 默认展示的时间范围（小时）；本周有更早或更晚的安排时再向外扩展。 */
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 23;
/** 时间轴每小时的最小高度；视口放不下时由页面整体滚动。 */
const MIN_HOUR_HEIGHT = 40;

export type EventSegment = {
  event: CalendarOccurrence;
  /** 当天 0 点起算的分钟数，已裁剪到当天范围内。 */
  startMinute: number;
  endMinute: number;
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
    cluster.push({
      event,
      startMinute: startTime.hour() * 60 + startTime.minute(),
      endMinute: end === to ? 1440 : endTime.hour() * 60 + endTime.minute(),
      lane,
      lanes: 0,
    });
  }
  for (const segment of cluster) {
    segment.lanes = laneEnds.length;
  }
  return [...result, ...cluster];
}

/** 桌面端展示选中日所在周；窄屏表头作为日期条，时间轴只展示选中日。 */
export function CalendarWeekView({
  entries,
  date,
  timezone,
  now,
  onSelectDate,
  onSelect,
}: {
  entries: CalendarEntry[];
  date: string;
  timezone: string;
  now: number;
  onSelectDate: (date: string) => void;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const week = calendarWeek(date);
  const dates = Array.from({ length: 7 }, (_, index) => calendarDate(week, index));
  const events = entries.filter((entry): entry is CalendarOccurrence => entry.kind === "event");
  const daySegments = dates.map((day) => layoutDayEvents(events, day, timezone));
  const nowTime = dayjs(now).tz(timezone);
  const today = nowTime.format("YYYY-MM-DD");
  const nowMinute = nowTime.hour() * 60 + nowTime.minute();
  const taskNodes = dates.map((day) => {
    const { from, to } = calendarRange(day, 1, timezone);
    return entries
      .filter((entry) => entry.kind === "task")
      .flatMap((task) =>
        [
          { label: "开始", at: task.plannedAt },
          { label: "截止", at: task.dueAt },
        ]
          .filter(({ at }) => at !== null && at >= from && at < to)
          .map(({ label, at }) => ({ task, label, at: at! })),
      );
  });

  // 展示范围覆盖默认时段、本周所有事件和今天的当前时刻，按整点取整。
  const coveredMinutes = [
    ...daySegments.flat().flatMap((segment) => [segment.startMinute, segment.endMinute]),
    ...(dates.includes(today) ? [nowMinute] : []),
  ];
  const startHour = Math.min(
    DEFAULT_START_HOUR,
    ...coveredMinutes.map((minute) => Math.floor(minute / 60)),
  );
  const endHour = Math.max(
    DEFAULT_END_HOUR,
    ...coveredMinutes.map((minute) => Math.ceil(minute / 60)),
  );
  const hours = endHour - startHour;
  /** 当天分钟数在时间轴上的百分比位置。 */
  const position = (minute: number) => `${((minute - startHour * 60) / (hours * 60)) * 100}%`;

  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border bg-card">
      <div className="md:min-w-[640px]">
        <div className="border-b">
          <div className="grid grid-cols-7 md:grid-cols-[52px_repeat(7,minmax(0,1fr))]">
            <div className="hidden md:block" />
            {dates.map((day, index) => (
              <button
                type="button"
                key={day}
                aria-pressed={day === date}
                onClick={() => onSelectDate(day)}
                className="flex flex-col items-center gap-1 py-2 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset md:pointer-events-none"
              >
                <span>周{["一", "二", "三", "四", "五", "六", "日"][index]}</span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-sm text-foreground tabular-nums",
                    day === today && "bg-primary font-semibold text-primary-foreground",
                    day === date && day !== today && "max-md:bg-primary/20 max-md:font-semibold",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
              </button>
            ))}
          </div>
          {taskNodes.some((nodes) => nodes.length > 0) && (
            <div className="grid grid-cols-1 border-t md:grid-cols-[52px_repeat(7,minmax(0,1fr))]">
              <div className="hidden py-1.5 pr-2 text-right text-[11px] text-muted-foreground md:block">
                任务
              </div>
              {taskNodes.map((nodes, index) => (
                <div
                  key={dates[index]}
                  className={cn(
                    "min-w-0 space-y-1 p-1 md:border-l",
                    dates[index] !== date && "max-md:hidden",
                  )}
                >
                  {nodes.map(({ task, label, at }) => (
                    <button
                      type="button"
                      key={`${task.id}:${label}`}
                      onClick={() => onSelect(task)}
                      title={`${calendarTime(at, timezone)} ${label} · ${task.title} · ${calendarStatusLabels[task.status]}`}
                      className={cn(
                        "flex w-full items-center gap-1 rounded-md bg-amber-100/80 px-1.5 py-0.5 text-left text-xs text-amber-900 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        (task.status === "completed" || task.status === "cancelled") &&
                          "line-through opacity-60",
                        task.status === "expired" && "opacity-60",
                      )}
                    >
                      {label === "截止" ? (
                        <Flag aria-label="截止" className="size-3 shrink-0" />
                      ) : (
                        <Play aria-label="开始" className="size-3 shrink-0" />
                      )}
                      <span className="truncate">
                        {calendarTime(at, timezone)} {task.title}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          className="grid grid-cols-[44px_minmax(0,1fr)] md:grid-cols-[52px_repeat(7,minmax(0,1fr))]"
          style={{ height: `max(calc(100dvh - 17rem), ${hours * MIN_HOUR_HEIGHT}px)` }}
        >
          <div className="relative">
            {Array.from({ length: hours - 1 }, (_, index) => (
              <span
                key={index}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                style={{ top: position((startHour + index + 1) * 60) }}
              >
                {String(startHour + index + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {dates.map((day, dayIndex) => (
            <div
              key={day}
              className={cn(
                "relative border-l",
                day !== date && "max-md:hidden",
                day === today && "bg-primary/[0.04]",
              )}
            >
              {Array.from({ length: hours - 1 }, (_, index) => (
                <div
                  key={index}
                  className="absolute inset-x-0 border-t border-border/70"
                  style={{ top: position((startHour + index + 1) * 60) }}
                />
              ))}
              {daySegments[dayIndex].map(({ event, startMinute, endMinute, lane, lanes }) => (
                <button
                  type="button"
                  key={event.occurrenceId}
                  onClick={() => onSelect(event)}
                  title={`${event.title} ${calendarTime(event.startAt, timezone, true)}–${calendarTime(event.endAt, timezone, true)}`}
                  className={cn(
                    "absolute flex min-h-4 flex-col justify-start overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs leading-4 transition-colors focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    event.status === "cancelled"
                      ? "border-muted-foreground/40 bg-muted text-muted-foreground line-through"
                      : "border-primary bg-primary/20 hover:bg-primary/30",
                    event.endAt <= now && "opacity-60",
                  )}
                  style={{
                    top: `calc(${position(startMinute)} + 1px)`,
                    height: `calc(${((endMinute - startMinute) / (hours * 60)) * 100}% - 2px)`,
                    left: `calc(${(lane * 100) / lanes}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                >
                  <div className="truncate font-medium">{event.title}</div>
                  {endMinute - startMinute >= 60 && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {calendarTime(event.startAt, timezone)}–{calendarTime(event.endAt, timezone)}
                    </div>
                  )}
                  {endMinute - startMinute >= 150 && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {event.description}
                    </p>
                  )}
                </button>
              ))}
              {day === today && (
                <div
                  role="img"
                  aria-label="当前时间"
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-rose-500"
                  style={{ top: position(nowMinute) }}
                >
                  <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-rose-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

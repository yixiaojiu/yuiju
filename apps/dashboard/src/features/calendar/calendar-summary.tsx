"use client";

import { cn } from "@yuiju/shared/ui/utils";
import Link from "next/link";
import type { CalendarResponse } from "@/app/api/[[...route]]/routes/calendar";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { calendarQueryUrl, calendarRange, calendarTime } from "./time";

/** 首页今日时间线；条目顺序沿用世界返回的时间排序。 */
export function CalendarSummary({
  characterId,
  timezone,
  now,
}: {
  characterId: string;
  timezone: string;
  now: number;
}) {
  const { from, to } = calendarRange(today(timezone), 1, timezone);
  const { data, error } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, {
      type: "range",
      from,
      to,
      statuses: ["scheduled", "pending", "in_progress"],
    }),
    30_000,
  );
  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">今日安排</h2>
        <Link
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          href="/calendar"
        >
          查看日程 →
        </Link>
      </header>
      {data?.type !== "range" ? (
        <p
          role={error ? "alert" : "status"}
          className={cn("mt-3 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error || "加载中…"}
        </p>
      ) : data.entries.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">今天没有安排</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {data.entries.map((entry) => {
            const ongoing = entry.kind === "event" && entry.startAt <= now && now < entry.endAt;
            const past = entry.kind === "event" && entry.endAt <= now;
            return (
              <li
                key={entry.kind === "event" ? entry.occurrenceId : entry.id}
                className={cn("flex gap-3", past && "opacity-50")}
              >
                <span className="w-24 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">
                  {entry.kind === "event"
                    ? `${calendarTime(entry.startAt, timezone)}–${calendarTime(entry.endAt, timezone)}`
                    : [
                        { label: "开始", at: entry.plannedAt },
                        { label: "截止", at: entry.dueAt },
                      ]
                        .filter(({ at }) => at !== null && at >= from && at < to)
                        .map(({ label, at }) => `${calendarTime(at!, timezone)} ${label}`)
                        .join(" · ")}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 border-l-2 pl-3 text-sm",
                    entry.kind === "task"
                      ? "border-amber-400"
                      : ongoing
                        ? "border-primary font-medium"
                        : "border-primary/40",
                  )}
                >
                  {entry.title}
                  {ongoing && <span className="ml-2 text-xs text-primary">进行中</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

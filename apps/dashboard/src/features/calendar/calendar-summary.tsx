"use client";

import Link from "next/link";
import type { CalendarResponse } from "@/app/api/[[...route]]/routes/calendar";
import { QueryState } from "@/components/query-state";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { calendarQueryUrl, calendarRange, calendarTime } from "./time";

export function CalendarSummary({
  characterId,
  timezone,
}: {
  characterId: string;
  timezone: string;
}) {
  const { data, error } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, {
      type: "range",
      ...calendarRange(today(timezone), 1, timezone),
      statuses: ["scheduled", "pending", "in_progress"],
    }),
    30_000,
  );
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">今日安排</h2>
        <Link className="text-xs text-primary underline" href="/calendar">
          查看日程
        </Link>
      </div>
      {data?.type !== "range" ? (
        <QueryState error={error} />
      ) : data.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无安排</p>
      ) : (
        data.entries.map((entry) => (
          <div key={entry.kind === "event" ? entry.occurrenceId : entry.id} className="text-xs">
            <strong>{entry.title}</strong>
            <p className="mt-1 text-muted-foreground">
              {entry.kind === "event"
                ? `${calendarTime(entry.startAt, timezone)}–${calendarTime(entry.endAt, timezone)}`
                : [
                    entry.plannedAt === null
                      ? ""
                      : `开始 ${calendarTime(entry.plannedAt, timezone)}`,
                    entry.dueAt === null ? "" : `截止 ${calendarTime(entry.dueAt, timezone)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
        ))
      )}
    </section>
  );
}

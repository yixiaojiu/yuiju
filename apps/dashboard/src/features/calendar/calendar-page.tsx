"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import type { CalendarEntry } from "@yuiju/shared/world/calendar";
import { useEffect, useState } from "react";
import type { CalendarResponse } from "@/app/api/[[...route]]/routes/calendar";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { QueryState } from "@/components/query-state";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { CalendarDetailSheet } from "./calendar-detail-sheet";
import { CalendarTaskList } from "./calendar-task-list";
import { CalendarWeekView } from "./calendar-week-view";
import { calendarDate, calendarQueryUrl, calendarRange, calendarWeek } from "./time";

export function CalendarPage({
  characters,
  timezone,
}: {
  characters: CharacterOption[];
  timezone: string;
}) {
  const [characterId, setCharacterId] = useState(characters[0]?.id);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">日程</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </header>
      {characterId === undefined ? (
        <p>未配置角色</p>
      ) : (
        <CalendarQuery key={characterId} characterId={characterId} timezone={timezone} />
      )}
    </div>
  );
}
function CalendarQuery({ characterId, timezone }: { characterId: string; timezone: string }) {
  const [week, setWeek] = useState(() => calendarWeek(today(timezone)));
  const [selection, setSelection] = useState<CalendarEntry | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const { data, error } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, {
      type: "range",
      ...calendarRange(week, 7, timezone),
      statuses: ["scheduled", "cancelled", "pending", "in_progress", "completed", "expired"],
    }),
    30_000,
  );
  const { data: tasks, error: tasksError } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, { type: "tasks", statuses: ["pending", "in_progress"] }),
    30_000,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {week} — {calendarDate(week, 6)} · {timezone}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setWeek(calendarDate(week, -7))}>
            上一周
          </Button>
          <Button variant="outline" onClick={() => setWeek(calendarWeek(today(timezone)))}>
            本周
          </Button>
          <Button variant="outline" onClick={() => setWeek(calendarDate(week, 7))}>
            下一周
          </Button>
          <input
            aria-label="选择日期"
            type="date"
            value={week}
            onChange={(event) => {
              if (event.target.value) {
                setWeek(calendarWeek(event.target.value));
              }
            }}
            className="rounded-lg border bg-background p-2 text-sm"
          />
        </div>
      </div>
      {data?.type === "range" ? (
        <>
          <CalendarWeekView
            entries={data.entries}
            week={week}
            timezone={timezone}
            now={now}
            onSelect={setSelection}
          />
          {data.entries.length === 0 && (
            <p className="text-sm text-muted-foreground">本周暂无安排</p>
          )}
        </>
      ) : (
        <QueryState error={error} />
      )}
      {tasks?.type === "tasks" ? (
        <CalendarTaskList
          tasks={tasks.tasks}
          timezone={timezone}
          now={now}
          onSelect={setSelection}
        />
      ) : (
        <QueryState error={tasksError} />
      )}
      {selection !== null && (
        <CalendarDetailSheet
          characterId={characterId}
          selection={selection}
          timezone={timezone}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

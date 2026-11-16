"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import { WeekPicker } from "@yuiju/shared/ui/components/date-picker";
import type { CalendarEntry } from "@yuiju/shared/world/calendar";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { CalendarResponse } from "@/app/api/[[...route]]/routes/calendar";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { QueryState } from "@/components/query-state";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { CalendarDetailSheet } from "./calendar-detail-sheet";
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
        <h1 className="text-xl font-semibold">日程</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </header>
      {characterId === undefined ? (
        <p className="text-sm text-muted-foreground">未配置角色</p>
      ) : (
        <CalendarQuery key={characterId} characterId={characterId} timezone={timezone} />
      )}
    </div>
  );
}

/** 只保存选中日：桌面端展示其所在周，窄屏只展示这一天。 */
function CalendarQuery({ characterId, timezone }: { characterId: string; timezone: string }) {
  const [date, setDate] = useState(() => today(timezone));
  const [selection, setSelection] = useState<CalendarEntry | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const week = calendarWeek(date);
  const { data, error } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, {
      type: "range",
      ...calendarRange(week, 7, timezone),
      statuses: ["scheduled", "cancelled", "pending", "in_progress", "completed", "expired"],
    }),
    30_000,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-52">
          <WeekPicker id="calendar-week" value={date} onChange={setDate} />
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{timezone}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setDate(today(timezone))}>
            今天
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一周"
            onClick={() => setDate(calendarDate(date, -7))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一周"
            onClick={() => setDate(calendarDate(date, 7))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {data?.type === "range" ? (
        <CalendarWeekView
          entries={data.entries}
          date={date}
          timezone={timezone}
          now={now}
          onSelectDate={setDate}
          onSelect={setSelection}
        />
      ) : (
        <QueryState error={error} />
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

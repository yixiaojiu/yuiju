"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import type { CalendarEntry, CalendarItem } from "@yuiju/shared/world/calendar";
import type { CalendarResponse } from "@/app/api/[[...route]]/routes/calendar";
import { QueryState } from "@/components/query-state";
import { useQuery } from "@/lib/use-query";
import { calendarQueryUrl, calendarStatusLabels, calendarTime } from "./time";

export function CalendarDetailSheet({
  characterId,
  selection,
  timezone,
  onClose,
}: {
  characterId: string;
  selection: CalendarEntry;
  timezone: string;
  onClose: () => void;
}) {
  const { data, error } = useQuery<CalendarResponse>(
    calendarQueryUrl(characterId, { type: "item", itemId: selection.id }),
  );
  const item: CalendarItem | undefined = data?.type === "item" ? data.item : undefined;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{selection.title}</SheetTitle>
        </SheetHeader>
        {!item ? (
          <div className="p-4">
            <QueryState error={error} />
          </div>
        ) : (
          <div className="space-y-5 px-4 pb-8 text-sm">
            <p className="text-muted-foreground">
              {item.kind === "event" ? "日程" : "任务"} · {calendarStatusLabels[item.status]}
            </p>
            <p className="whitespace-pre-wrap">{item.description}</p>
            {item.kind === "event" ? (
              <>
                <p>
                  本次安排：
                  {calendarTime(
                    selection.kind === "event" ? selection.startAt : item.startAt,
                    timezone,
                    true,
                  )}{" "}
                  —{" "}
                  {calendarTime(
                    selection.kind === "event" ? selection.endAt : item.endAt,
                    timezone,
                    true,
                  )}
                </p>
                <p>
                  {item.repeatWeekdays === null
                    ? "单次日程"
                    : `每周 ${item.repeatWeekdays.map((day) => ["一", "二", "三", "四", "五", "六", "日"][day - 1]).join("、")}`}
                </p>
                <p>
                  {item.remindBeforeStartMinutes === null
                    ? "不提醒"
                    : item.remindBeforeStartMinutes === 0
                      ? "开始时提醒"
                      : `开始前 ${item.remindBeforeStartMinutes} 分钟提醒`}
                </p>
                {item.repeatUntilAt !== null && (
                  <p>规则有效至 {calendarTime(item.repeatUntilAt, timezone, true)}</p>
                )}
              </>
            ) : (
              <>
                <p>
                  计划开始：
                  {item.plannedAt === null
                    ? "未安排"
                    : calendarTime(item.plannedAt, timezone, true)}
                </p>
                <p>
                  截止：{item.dueAt === null ? "未设置" : calendarTime(item.dueAt, timezone, true)}
                </p>
                <p>
                  下次关注：
                  {item.attentionAt === null
                    ? "未安排"
                    : calendarTime(item.attentionAt, timezone, true)}
                </p>
                <p>进度：{item.progress || "暂无"}</p>
                <p>有效至 {calendarTime(item.expiresAt, timezone, true)}</p>
              </>
            )}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              记录保留至 {calendarTime(item.deleteAt, timezone, true)} · {timezone}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

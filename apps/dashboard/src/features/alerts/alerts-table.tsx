import type {
  MonitoringAlertEntry,
  MonitoringAlertsResult,
} from "@yuiju/shared/monitoring/storage";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@yuiju/shared/ui/components/table";
import { cn } from "@yuiju/shared/ui/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CharacterOption } from "@/components/character-select";
import { QueryState } from "@/components/query-state";
import { TablePagination } from "@/components/table-pagination";
import { formatTime } from "@/lib/date";

export function AlertsTable({
  characters,
  data,
  error,
  onPageChange,
}: {
  characters: CharacterOption[];
  data?: MonitoringAlertsResult;
  error?: string;
  onPageChange: (page: number) => void;
}) {
  const [selected, setSelected] = useState<MonitoringAlertEntry | null>(null);
  if (!data) {
    return <QueryState error={error} />;
  }
  if (data.entries.length === 0) {
    return <QueryState empty />;
  }
  return (
    <>
      <div className="rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["时间", "异常", "影响", "来源", "连续失败", ""].map((column) => (
                <TableHead
                  key={column}
                  className="h-10 px-4 text-xs font-normal text-muted-foreground"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((entry) => (
              <TableRow key={entry.id} className="relative hover:bg-accent/40">
                <TableCell className="px-4 py-3 align-top text-xs text-muted-foreground tabular-nums">
                  {formatTime(entry.created_at, true)}
                </TableCell>
                <TableCell className="min-w-56 px-4 py-3 align-top whitespace-normal">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        entry.severity === "error" ? "bg-destructive" : "bg-amber-400",
                      )}
                    />
                    <span className="sr-only">{entry.severity === "error" ? "错误" : "警告"}</span>
                    {entry.title}
                  </div>
                  <div className="mt-0.5 pl-3.5 font-mono text-xs text-muted-foreground">
                    {entry.monitor_key}
                  </div>
                </TableCell>
                <TableCell className="min-w-48 px-4 py-3 align-top text-xs whitespace-normal">
                  {entry.impact}
                </TableCell>
                <TableCell className="px-4 py-3 align-top text-xs">
                  <div>
                    {characters.find((character) => character.id === entry.character_id)?.name ??
                      entry.character_id ??
                      entry.app}
                  </div>
                  {entry.channel_id && (
                    <div className="mt-0.5 text-muted-foreground">{entry.channel_id}</div>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 align-top text-xs tabular-nums">
                  {entry.consecutive_failures}
                </TableCell>
                <TableCell className="w-10 px-2 py-3 align-top">
                  {/* 按钮覆盖整行，点击任意位置打开详情 */}
                  <button
                    type="button"
                    aria-label={`查看告警 ${entry.title}`}
                    onClick={() => setSelected(entry)}
                    className="flex text-muted-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={onPageChange}
        />
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
          <SheetHeader className="gap-2 pr-12">
            <span
              className={cn(
                "w-fit rounded-full px-2 py-0.5 text-xs",
                selected?.severity === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-100 text-amber-900",
              )}
            >
              {selected?.severity === "error" ? "错误" : "警告"}
            </span>
            <SheetTitle className="text-lg">{selected?.title}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="space-y-6 px-4 pb-8">
              <dl className="divide-y border-y text-sm">
                {[
                  ["时间", formatTime(selected.created_at, true)],
                  ["检测项", selected.monitor_key],
                  ["应用", selected.app],
                  ["影响", selected.impact],
                  ["连续失败", String(selected.consecutive_failures)],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 py-2.5">
                    <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 flex-1 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs leading-5">
                {selected.message}
              </pre>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

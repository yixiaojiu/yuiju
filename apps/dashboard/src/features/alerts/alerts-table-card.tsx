import type {
  MonitoringAlertEntry,
  MonitoringAlertsResult,
} from "@yuiju/shared/monitoring/storage";
import { Button } from "@yuiju/shared/ui/components/button";
import { Card } from "@yuiju/shared/ui/components/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@yuiju/shared/ui/components/table";
import { useState } from "react";
import type { CharacterOption } from "@/components/character-select";
import { TablePagination } from "@/components/table-pagination";
import { formatTime } from "@/lib/date";

const cellStyle = "whitespace-nowrap px-4 py-3 text-xs tabular-nums";

export function AlertsTableCard({
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
  return (
    <>
      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <Table>
          <TableHeader className="border-b bg-secondary/50">
            <TableRow className="hover:bg-transparent">
              {["时间", "级别", "异常", "影响", "角色 / 群聊", "连续失败", "操作"].map((column) => (
                <TableHead
                  key={column}
                  className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className={`p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                  role={error ? "alert" : "status"}
                >
                  {error || "加载中…"}
                </TableCell>
              </TableRow>
            ) : data.entries.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="p-10 text-center text-muted-foreground">
                  暂无告警
                </TableCell>
              </TableRow>
            ) : (
              data.entries.map((entry) => (
                <TableRow key={entry.id} className="border-b last:border-0 hover:bg-secondary/30">
                  <TableCell className={cellStyle}>{formatTime(entry.created_at, true)}</TableCell>
                  <TableCell className={cellStyle}>
                    <span
                      className={
                        entry.severity === "error" ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      {entry.severity === "error" ? "错误" : "警告"}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-48 px-4 py-3 text-xs">
                    <div>{entry.title}</div>
                    <div className="mt-1 text-muted-foreground">{entry.monitor_key}</div>
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal px-4 py-3 text-xs">
                    {entry.impact}
                  </TableCell>
                  <TableCell className={cellStyle}>
                    <div>
                      {characters.find((character) => character.id === entry.character_id)?.name ??
                        entry.character_id ??
                        "—"}
                    </div>
                    {entry.channel_id && (
                      <div className="mt-1 text-muted-foreground">{entry.channel_id}</div>
                    )}
                  </TableCell>
                  <TableCell className={cellStyle}>{entry.consecutive_failures}</TableCell>
                  <TableCell className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(entry)}>
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {data && (
          <TablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={onPageChange}
          />
        )}
      </Card>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{selected?.title}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 px-4 pb-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-words">
                <dt className="text-muted-foreground">时间</dt>
                <dd>{formatTime(selected.created_at, true)}</dd>
                <dt className="text-muted-foreground">检测项</dt>
                <dd>{selected.monitor_key}</dd>
                <dt className="text-muted-foreground">应用</dt>
                <dd>{selected.app}</dd>
                <dt className="text-muted-foreground">影响</dt>
                <dd>{selected.impact}</dd>
              </dl>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/50 p-3">
                {selected.message}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

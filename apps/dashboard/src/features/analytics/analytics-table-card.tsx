import { useState } from "react";
import type {
  AnalyticsEntry,
  AnalyticsEventName,
  AnalyticsResponse,
} from "@/app/api/[[...route]]/routes/analytics";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime } from "@/lib/date";
import { formatTokens } from "./format";

const statusLabels = { success: "成功", failed: "失败", cancelled: "取消", timeout: "超时" };
const cellStyle = "whitespace-nowrap px-4 py-3 text-xs tabular-nums";

export function AnalyticsTableCard({
  eventName,
  data,
  error,
  onPageChange,
}: {
  eventName: AnalyticsEventName;
  data?: AnalyticsResponse;
  error?: string;
  onPageChange: (page: number) => void;
}) {
  const [selected, setSelected] = useState<AnalyticsEntry | null>(null);
  const columns =
    eventName === "llm.request"
      ? [
          "时间",
          "模型组",
          "模型",
          "供应商",
          "结果",
          "耗时",
          "输入 / 输出 token",
          "缓存命中率",
          "操作",
        ]
      : ["时间", "群聊", "耗时", "操作"];
  return (
    <>
      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <Table className="w-full text-left text-sm">
          <TableHeader className="border-b bg-secondary/50 text-xs text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column}
                  className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground"
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
                  colSpan={columns.length}
                  className={`whitespace-normal p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                  role={error ? "alert" : "status"}
                >
                  {error || "加载中…"}
                </TableCell>
              </TableRow>
            ) : data.entries.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="p-10 text-center text-muted-foreground"
                >
                  暂无记录
                </TableCell>
              </TableRow>
            ) : (
              data.entries.map((entry) => (
                <TableRow key={entry.id} className="border-b last:border-0 hover:bg-secondary/30">
                  <TableCell className={cellStyle}>{formatTime(entry.eventTime, true)}</TableCell>
                  {entry.eventName === "llm.request" ? (
                    <>
                      <TableCell className={cellStyle}>{entry.eventData.group}</TableCell>
                      <TableCell className="max-w-72 whitespace-normal break-words px-4 py-3 text-xs">
                        {entry.eventData.model}
                      </TableCell>
                      <TableCell className={cellStyle}>{entry.eventData.host}</TableCell>
                      <TableCell
                        className={`${cellStyle} ${entry.eventData.status === "failed" || entry.eventData.status === "timeout" ? "text-destructive" : ""}`}
                      >
                        {statusLabels[entry.eventData.status]}
                      </TableCell>
                      <TableCell className={cellStyle}>
                        {(entry.eventData.durationMs / 1000).toFixed(2)} 秒
                      </TableCell>
                      <TableCell className={cellStyle}>
                        {formatTokens(entry.eventData.inputTokens)} /{" "}
                        {formatTokens(entry.eventData.outputTokens)}
                      </TableCell>
                      <TableCell className={cellStyle}>
                        {entry.eventData.inputTokens !== null &&
                        entry.eventData.inputTokens > 0 &&
                        entry.eventData.cacheReadTokens !== null
                          ? `${((entry.eventData.cacheReadTokens / entry.eventData.inputTokens) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className={cellStyle}>{entry.eventData.channelId}</TableCell>
                      <TableCell className={cellStyle}>
                        {(entry.eventData.durationMs / 1000).toFixed(2)} 秒
                      </TableCell>
                    </>
                  )}
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
            total={data.summary.total}
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
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl" aria-describedby={undefined}>
          <SheetHeader className="pr-12">
            <SheetTitle>埋点详情</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="min-w-0 px-4 pb-4">
              <MonacoEditorPanel
                language="json"
                value={JSON.stringify(
                  { ...selected, eventTime: new Date(selected.eventTime).toISOString() },
                  null,
                  2,
                )}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

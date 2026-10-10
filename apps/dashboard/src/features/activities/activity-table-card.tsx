import type { ActivitiesResponse } from "@/app/api/[[...route]]/routes/activities";
import { TablePagination } from "@/components/table-pagination";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime } from "@/lib/date";

export function ActivityTableCard({
  data,
  error,
  onPageChange,
}: {
  data?: ActivitiesResponse;
  error?: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-2xl py-0">
      <Table className="w-full text-left text-sm">
        <TableHeader className="border-b bg-secondary/50 text-xs text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            {["活动", "开始时间", "结束时间", "耗时", "结果"].map((title) => (
              <TableHead
                key={title}
                className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground"
              >
                {title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!data ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className={`whitespace-normal p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                role={error ? "alert" : "status"}
              >
                {error || "加载中…"}
              </TableCell>
            </TableRow>
          ) : data.activities.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="p-10 text-center text-muted-foreground">
                暂无记录
              </TableCell>
            </TableRow>
          ) : (
            data.activities.map((activity) => (
              <TableRow key={activity.id} className="border-b last:border-0 hover:bg-secondary/30">
                <TableCell className="whitespace-nowrap px-4 py-4 align-top font-medium">
                  {activity.action}
                </TableCell>
                <TableCell className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                  {formatTime(activity.startedAt, true)}
                </TableCell>
                <TableCell className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                  {activity.completedAt !== null ? formatTime(activity.completedAt, true) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap px-4 py-4 align-top text-xs">
                  {activity.completedAt !== null
                    ? `${Math.round((activity.completedAt - activity.startedAt) / 60000)}分钟`
                    : "—"}
                </TableCell>
                <TableCell className="min-w-64 whitespace-pre-wrap break-words px-4 py-4 align-top text-xs leading-6 text-muted-foreground">
                  {activity.description}
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
  );
}

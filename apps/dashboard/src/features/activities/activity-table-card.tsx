import type { ActivitiesResponse } from "@/api/activities";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTime } from "@/lib/date";

export function ActivityTableCard({
  data,
  error,
  timezone,
  onPageChange,
}: {
  data?: ActivitiesResponse;
  error?: string;
  timezone: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-2xl py-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-secondary/50 text-xs text-muted-foreground">
            <tr>
              {["活动", "开始时间", "结束时间", "耗时", "结果"].map((title) => (
                <th key={title} className="whitespace-nowrap px-4 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td
                  colSpan={5}
                  className={`p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                  role={error ? "alert" : "status"}
                >
                  {error || "加载中…"}
                </td>
              </tr>
            ) : data.activities.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-10 text-center text-muted-foreground">
                  暂无记录
                </td>
              </tr>
            ) : (
              data.activities.map((activity) => (
                <tr key={activity.id} className="border-b last:border-0 hover:bg-secondary/30">
                  <td className="whitespace-nowrap px-4 py-4 align-top font-medium">
                    {activity.action}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                    {formatTime(activity.startedAt, timezone, true)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                    {activity.completedAt !== null
                      ? formatTime(activity.completedAt, timezone, true)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 align-top text-xs">
                    {activity.completedAt !== null
                      ? `${Math.round((activity.completedAt - activity.startedAt) / 60000)}分钟`
                      : "—"}
                  </td>
                  <td className="min-w-64 whitespace-pre-wrap break-words px-4 py-4 align-top text-xs leading-6 text-muted-foreground">
                    {activity.description}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-3.5">
          <span className="text-xs text-muted-foreground">
            共 {data.total} 条 · 第 {data.page} /{" "}
            {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={data.page === 1}
              onClick={() => onPageChange(data.page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              disabled={data.page * data.pageSize >= data.total}
              onClick={() => onPageChange(data.page + 1)}
            >
              下一页
            </Button>
          </div>
        </footer>
      )}
    </Card>
  );
}

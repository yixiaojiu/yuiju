import dayjs from "dayjs";
import type { ActivitiesResponse, ActivityEntry } from "@/app/api/[[...route]]/routes/activities";
import { QueryState } from "@/components/query-state";
import { TablePagination } from "@/components/table-pagination";
import { formatTime } from "@/lib/date";

/** 按浏览器本地日期分组，组内保持接口返回的顺序。 */
export function ActivityList({
  data,
  error,
  onPageChange,
}: {
  data?: ActivitiesResponse;
  error?: string;
  onPageChange: (page: number) => void;
}) {
  if (!data) {
    return <QueryState error={error} />;
  }
  if (data.activities.length === 0) {
    return <QueryState empty />;
  }
  const groups = new Map<string, ActivityEntry[]>();
  for (const activity of data.activities) {
    const date = dayjs(activity.startedAt).format("YYYY-MM-DD");
    groups.set(date, [...(groups.get(date) ?? []), activity]);
  }
  return (
    <div className="rounded-2xl border bg-card">
      {[...groups].map(([date, activities]) => (
        <section key={date} className="border-b last:border-0">
          <h2 className="sticky top-14 z-10 bg-card/95 px-5 pt-4 pb-2 text-xs font-medium text-muted-foreground backdrop-blur md:top-0">
            {dayjs(date).format("M月D日")} 周{"日一二三四五六"[dayjs(date).day()]}
          </h2>
          <ol className="px-5 pb-2">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="grid gap-x-5 gap-y-1 border-t py-3 first:border-0 sm:grid-cols-[96px_minmax(0,1fr)]"
              >
                <span className="pt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatTime(activity.startedAt)}–
                  {activity.completedAt === null ? "" : formatTime(activity.completedAt)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{activity.action}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {activity.completedAt === null
                        ? "进行中"
                        : `${Math.round((activity.completedAt - activity.startedAt) / 60000)} 分钟`}
                    </span>
                  </p>
                  {activity.description && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                      {activity.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <TablePagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPageChange={onPageChange}
      />
    </div>
  );
}

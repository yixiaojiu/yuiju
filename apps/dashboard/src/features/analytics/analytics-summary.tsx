import { cn } from "@yuiju/shared/ui/utils";
import type {
  AnalyticsEventName,
  AnalyticsSummary,
  CompressionDaily,
} from "@/app/api/[[...route]]/routes/analytics";
import { compressionSceneLabels, formatContextRatio, formatTokens } from "./format";

export function AnalyticsSummaryCards({
  eventName,
  summary,
}: {
  eventName: AnalyticsEventName;
  summary: AnalyticsSummary;
}) {
  let cards: { label: string; value: string; note?: string }[];
  if (eventName === "app.error") {
    cards = [{ label: "错误次数", value: summary.total.toLocaleString("zh-CN") }];
  } else if (eventName === "agent.context_compression") {
    cards = [
      { label: "压缩触发次数", value: summary.total.toLocaleString("zh-CN") },
      { label: "平均窗口占用（估算）", value: formatContextRatio(summary.averageContextRatio) },
      { label: "最高窗口占用（估算）", value: formatContextRatio(summary.maxContextRatio) },
    ];
  } else if (eventName === "llm.request") {
    cards = [
      { label: "请求数", value: summary.total.toLocaleString("zh-CN") },
      { label: "失败", value: summary.failedCount.toLocaleString("zh-CN") },
      { label: "超时", value: summary.timeoutCount.toLocaleString("zh-CN") },
      {
        label: "输入 token",
        value: formatTokens(summary.inputTokens),
        note: `已上报 ${summary.inputUsageCount} / ${summary.total}`,
      },
      {
        label: "输出 token",
        value: formatTokens(summary.outputTokens),
        note: `已上报 ${summary.outputUsageCount} / ${summary.total}`,
      },
      {
        label: "缓存命中率",
        value: summary.cacheHitRate === null ? "—" : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
        note: `有效请求 ${summary.cacheRequestCount} / ${summary.total}`,
      },
    ];
  } else {
    cards = [
      { label: "调用次数", value: summary.total.toLocaleString("zh-CN") },
      {
        label: "平均耗时",
        value:
          summary.averageDurationMs === null
            ? "—"
            : `${(summary.averageDurationMs / 1000).toFixed(2)} 秒`,
      },
      {
        label: "最大耗时",
        value:
          summary.maxDurationMs === null ? "—" : `${(summary.maxDurationMs / 1000).toFixed(2)} 秒`,
      },
    ];
  }
  // 用 1px 间隙当分隔线，列数按指标个数整除，避免出现空格子。
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl border bg-border",
        cards.length === 6 && "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
        cards.length === 3 && "sm:grid-cols-3",
      )}
    >
      {cards.map((card) => (
        <div key={card.label} className="bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{card.value}</p>
          {card.note && <p className="mt-0.5 text-xs text-muted-foreground">{card.note}</p>}
        </div>
      ))}
    </div>
  );
}

/** 与日期筛选使用相同的项目时区；按日期和场景聚合，分页不影响统计。 */
export function CompressionDailyTable({ entries }: { entries: CompressionDaily[] }) {
  return (
    <section className="rounded-2xl border bg-card">
      <h2 className="px-5 pt-4 pb-2 text-sm font-semibold">每日压缩</h2>
      {entries.length === 0 ? (
        <p className="px-5 pb-5 text-xs text-muted-foreground">暂无记录</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["日期", "场景", "触发次数", "平均占用（估算）", "最高占用（估算）"].map(
                  (label) => (
                    <th key={label} className="h-9 px-5 font-normal whitespace-nowrap">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {entries.map((entry) => (
                <tr key={`${entry.date}-${entry.scene}`} className="border-b last:border-0">
                  <td className="px-5 py-2.5">{entry.date}</td>
                  <td className="px-5 py-2.5">{compressionSceneLabels[entry.scene]}</td>
                  <td className="px-5 py-2.5">{entry.total.toLocaleString("zh-CN")}</td>
                  <td className="px-5 py-2.5">{formatContextRatio(entry.averageContextRatio)}</td>
                  <td className="px-5 py-2.5">{formatContextRatio(entry.maxContextRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

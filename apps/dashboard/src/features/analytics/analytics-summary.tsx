import type { AnalyticsEventName, AnalyticsSummary } from "@/app/api/[[...route]]/routes/analytics";
import { Card } from "@/components/ui/card";
import { formatTokens } from "./format";

export function AnalyticsSummaryCards({
  eventName,
  summary,
}: {
  eventName: AnalyticsEventName;
  summary: AnalyticsSummary;
}) {
  const cards =
    eventName === "llm.request"
      ? [
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
            value:
              summary.cacheHitRate === null ? "—" : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
            note: `有效请求 ${summary.cacheRequestCount} / ${summary.total}`,
          },
        ]
      : [
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
              summary.maxDurationMs === null
                ? "—"
                : `${(summary.maxDurationMs / 1000).toFixed(2)} 秒`,
          },
        ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} className="gap-2 rounded-2xl p-4">
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span className="text-xl font-semibold tabular-nums">{card.value}</span>
          {"note" in card && <span className="text-xs text-muted-foreground">{card.note}</span>}
        </Card>
      ))}
    </div>
  );
}

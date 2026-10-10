import type {
  AnalyticsEventName,
  AnalyticsSummary,
  CompressionDaily,
} from "@/app/api/[[...route]]/routes/analytics";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compressionSceneLabels, formatContextRatio, formatTokens } from "./format";

export function AnalyticsSummaryCards({
  eventName,
  summary,
}: {
  eventName: AnalyticsEventName;
  summary: AnalyticsSummary;
}) {
  let cards: { label: string; value: string; note?: string }[];
  if (eventName === "agent.context_compression") {
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
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} className="gap-2 rounded-2xl p-4">
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span className="text-xl font-semibold tabular-nums">{card.value}</span>
          {card.note && <span className="text-xs text-muted-foreground">{card.note}</span>}
        </Card>
      ))}
    </div>
  );
}

/** 与日期筛选使用相同的项目时区；按日期和场景聚合，分页不影响统计。 */
export function CompressionDailyTable({ entries }: { entries: CompressionDaily[] }) {
  return (
    <Card className="gap-0 overflow-hidden rounded-2xl py-0">
      <div className="px-4 py-3 text-sm font-medium">每日压缩</div>
      <Table>
        <TableHeader className="border-b bg-secondary/50 text-xs text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            {["日期", "场景", "触发次数", "平均占用（估算）", "最高占用（估算）"].map((label) => (
              <TableHead key={label} className="whitespace-nowrap px-4 py-3">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="p-10 text-center text-muted-foreground">
                暂无记录
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry) => (
              <TableRow
                key={`${entry.date}-${entry.scene}`}
                className="border-b last:border-0 hover:bg-secondary/30"
              >
                <TableCell className="px-4 py-3 text-xs tabular-nums">{entry.date}</TableCell>
                <TableCell className="px-4 py-3 text-xs">
                  {compressionSceneLabels[entry.scene]}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs tabular-nums">
                  {entry.total.toLocaleString("zh-CN")}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs tabular-nums">
                  {formatContextRatio(entry.averageContextRatio)}
                </TableCell>
                <TableCell className="px-4 py-3 text-xs tabular-nums">
                  {formatContextRatio(entry.maxContextRatio)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

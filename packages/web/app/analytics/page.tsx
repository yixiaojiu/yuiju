"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchChatReplyPerformance } from "@/lib/api/analytics";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [1, 7, 30] as const;

const OUTCOME_LABELS: Record<string, string> = {
  replied: "文字回复",
  sticker_sent: "表情回复",
  poked: "戳一戳",
  silent: "继续旁听",
  cancelled: "被新消息取消",
  failed: "失败",
};

const TRIGGER_LABELS: Record<string, string> = {
  directed: "定向触发",
  attention: "回复后关注",
  necessity: "必要性门控",
};

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(7);
  const [isDev, setIsDev] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const timeRange = useMemo(() => {
    return {
      start_time: new Date(refreshedAt.getTime() - rangeDays * 24 * 60 * 60 * 1000),
      end_time: refreshedAt,
    };
  }, [rangeDays, refreshedAt]);
  const { data, error, isLoading } = useSWR(
    ["chat-reply-performance", rangeDays, isDev, refreshedAt.toISOString()],
    () => fetchChatReplyPerformance({ ...timeRange, is_dev: isDev }),
  );

  return (
    <main className="mx-auto max-w-[1200px] px-[18px] pb-[36px] pt-[18px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2f47]">聊天性能</h1>
          <p className="mt-1 text-sm text-[#667791]">
            Planner-Replyer 链路埋点，数据自动保留 30 天。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[#c8dbef] bg-white p-1">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  rangeDays === days
                    ? "bg-[#91c4ee]/35 text-[#1f2f47]"
                    : "text-[#667791] hover:bg-[#91c4ee]/15",
                )}
              >
                {days} 天
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[#c8dbef] bg-white p-1">
            {[
              { value: false, label: "生产" },
              { value: true, label: "开发" },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setIsDev(option.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isDev === option.value
                    ? "bg-[#91c4ee]/35 text-[#1f2f47]"
                    : "text-[#667791] hover:bg-[#91c4ee]/15",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRefreshedAt(new Date())}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            刷新
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#d05d58]">
            {error instanceof Error ? error.message : "聊天性能数据加载失败"}
          </CardContent>
        </Card>
      ) : null}

      {!error && (isLoading || !data) ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#667791]">
            正在加载埋点数据...
          </CardContent>
        </Card>
      ) : null}

      {!error && data ? (
        <div className="grid gap-4">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["触发链路", String(data.summary.total_count)],
              ["产生回复", String(data.summary.replied_count)],
              ["首条回复 P50", formatDuration(data.summary.p50_first_reply_duration_ms)],
              ["首条回复 P95", formatDuration(data.summary.p95_first_reply_duration_ms)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-[#667791]">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1f2f47]">{value}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>端到端耗时</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
                <Metric label="平均" value={data.summary.average_total_duration_ms} />
                <Metric label="P50" value={data.summary.p50_total_duration_ms} />
                <Metric label="P95" value={data.summary.p95_total_duration_ms} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>阶段平均耗时</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Planner" value={data.summary.average_planner_duration_ms} />
                <Metric label="Replyer" value={data.summary.average_replyer_duration_ms} />
                <Metric label="Wait" value={data.summary.average_wait_duration_ms} />
                <Metric label="平台发送" value={data.summary.average_platform_send_duration_ms} />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <DistributionCard
              title="结果分布"
              items={data.outcome_counts.map((item) => ({
                label: OUTCOME_LABELS[item.outcome] ?? item.outcome,
                count: item.count,
              }))}
              total={data.summary.total_count}
            />
            <DistributionCard
              title="触发来源"
              items={data.trigger_counts.map((item) => ({
                label: TRIGGER_LABELS[item.trigger_type] ?? item.trigger_type,
                count: item.count,
              }))}
              total={data.summary.total_count}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>最近 100 条</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-[#d9e6f5] text-[#667791]">
                  <tr>
                    <th className="px-2 py-2 font-medium">时间</th>
                    <th className="px-2 py-2 font-medium">触发</th>
                    <th className="px-2 py-2 font-medium">行动</th>
                    <th className="px-2 py-2 font-medium">结果</th>
                    <th className="px-2 py-2 text-right font-medium">总耗时</th>
                    <th className="px-2 py-2 text-right font-medium">首条回复</th>
                    <th className="px-2 py-2 text-right font-medium">Planner</th>
                    <th className="px-2 py-2 text-right font-medium">Replyer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_events.map((event) => (
                    <tr key={event.id} className="border-b border-[#edf3f9] text-[#33445d]">
                      <td className="whitespace-nowrap px-2 py-2.5">
                        {formatEventTime(event.event_time)}
                      </td>
                      <td className="px-2 py-2.5">
                        {TRIGGER_LABELS[event.trigger_type] ?? event.trigger_type}
                      </td>
                      <td className="px-2 py-2.5">{event.action_type}</td>
                      <td className="px-2 py-2.5">
                        {OUTCOME_LABELS[event.outcome] ?? event.outcome}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatDuration(event.total_duration_ms)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatDuration(event.first_reply_duration_ms)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatDuration(event.planner_duration_ms)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatDuration(event.replyer_duration_ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.recent_events.length ? (
                <p className="py-8 text-center text-sm text-[#667791]">当前筛选范围内没有数据。</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-[#f6faff] px-3 py-3">
      <p className="text-xs text-[#667791]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[#1f2f47]">{formatDuration(value)}</p>
    </div>
  );
}

function DistributionCard({
  title,
  items,
  total,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex justify-between text-xs text-[#52647b]">
              <span>{item.label}</span>
              <span>{item.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#eaf2fa]">
              <div
                className="h-full rounded-full bg-[#76b5e8]"
                style={{ width: `${total ? (item.count / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
        {!items.length ? <p className="text-sm text-[#667791]">暂无数据。</p> : null}
      </CardContent>
    </Card>
  );
}

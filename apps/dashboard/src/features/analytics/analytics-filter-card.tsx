import { useState } from "react";
import type {
  AnalyticsEventName,
  CompressionScene,
  LlmRequestStatus,
} from "@/app/api/[[...route]]/routes/analytics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compressionSceneLabels } from "./format";

export type AnalyticsFilters = {
  eventName: AnalyticsEventName;
  startDate: string;
  endDate: string;
  channelId: string;
  group: string;
  model: string;
  host: string;
  status: LlmRequestStatus | "";
  scene: CompressionScene | "";
};

const inputStyle =
  "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm text-foreground";

/** 筛选草稿提交后才生效；不同事件的条件只在对应类型的查询中发送。 */
export function AnalyticsFilterCard({
  initialFilters,
  onSubmit,
}: {
  initialFilters: AnalyticsFilters;
  onSubmit: (filters: AnalyticsFilters) => void;
}) {
  const [draft, setDraft] = useState(initialFilters);
  return (
    <Card className="rounded-2xl p-3.5">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label
            htmlFor="analytics-eventName"
            className="grid gap-1.5 text-xs text-muted-foreground"
          >
            埋点类型
            <Select
              value={draft.eventName}
              onValueChange={(value) =>
                setDraft({ ...draft, eventName: value as AnalyticsEventName })
              }
            >
              <SelectTrigger id="analytics-eventName" className={inputStyle} aria-label="埋点类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="conversation.planner">Planner 耗时</SelectItem>
                <SelectItem value="conversation.replyer">Replyer 耗时</SelectItem>
                <SelectItem value="llm.request">LLM 请求</SelectItem>
                <SelectItem value="agent.context_compression">上下文压缩</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label
            htmlFor="analytics-dateRange"
            className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2"
          >
            日期范围
            <DateRangePicker
              id="analytics-dateRange"
              required
              value={draft}
              onChange={(range) => setDraft({ ...draft, ...range })}
            />
          </label>
          {draft.eventName === "agent.context_compression" && (
            <label htmlFor="analytics-scene" className="grid gap-1.5 text-xs text-muted-foreground">
              场景
              <Select
                value={draft.scene || "__all__"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    scene: (value === "__all__" ? "" : value) as AnalyticsFilters["scene"],
                  })
                }
              >
                <SelectTrigger id="analytics-scene" className={inputStyle} aria-label="场景">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__all__">全部</SelectItem>
                  {Object.entries(compressionSceneLabels).map(([scene, label]) => (
                    <SelectItem key={scene} value={scene}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {draft.eventName === "llm.request" ? (
            <>
              <label
                htmlFor="analytics-group"
                className="grid gap-1.5 text-xs text-muted-foreground"
              >
                模型组
                <Select
                  value={draft.group || "__all__"}
                  onValueChange={(value) =>
                    setDraft({ ...draft, group: value === "__all__" ? "" : value })
                  }
                >
                  <SelectTrigger id="analytics-group" className={inputStyle} aria-label="模型组">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__all__">全部</SelectItem>
                    {["chat", "flash", "strong", "multimodal"].map((group) => (
                      <SelectItem key={group} value={group}>
                        {group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                模型
                <input
                  className={inputStyle}
                  value={draft.model}
                  placeholder="完整模型名"
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                供应商
                <input
                  className={inputStyle}
                  value={draft.host}
                  placeholder="接口域名"
                  onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                />
              </label>
              <label
                htmlFor="analytics-status"
                className="grid gap-1.5 text-xs text-muted-foreground"
              >
                结果
                <Select
                  value={draft.status || "__all__"}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      status: (value === "__all__" ? "" : value) as AnalyticsFilters["status"],
                    })
                  }
                >
                  <SelectTrigger id="analytics-status" className={inputStyle} aria-label="结果">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__all__">全部</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                    <SelectItem value="timeout">超时</SelectItem>
                    <SelectItem value="cancelled">取消</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </>
          ) : (
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              群聊
              <input
                className={inputStyle}
                value={draft.channelId}
                placeholder="QQ 群号"
                onChange={(event) => setDraft({ ...draft, channelId: event.target.value })}
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(initialFilters);
              onSubmit(initialFilters);
            }}
          >
            重置
          </Button>
          <Button type="submit">查询</Button>
        </div>
      </form>
    </Card>
  );
}

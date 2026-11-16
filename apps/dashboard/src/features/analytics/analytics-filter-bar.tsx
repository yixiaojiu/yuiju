import { Button } from "@yuiju/shared/ui/components/button";
import { DateRangePicker } from "@yuiju/shared/ui/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";
import { X } from "lucide-react";
import { useState } from "react";
import type {
  AnalyticsEventName,
  CompressionScene,
  LlmRequestStatus,
} from "@/app/api/[[...route]]/routes/analytics";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { SegmentedControl } from "@/components/segmented-control";
import { compressionSceneLabels } from "./format";

export type AnalyticsFilters = {
  eventName: AnalyticsEventName;
  characterId: string;
  startDate: string;
  endDate: string;
  channelId: string;
  group: string;
  model: string;
  host: string;
  status: LlmRequestStatus | "";
  scene: CompressionScene | "";
  app: string;
  errorType: string;
};

const inputStyle =
  "h-9 w-full min-w-0 rounded-lg border bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-44";
const selectStyle = "w-36 rounded-lg bg-card";

/**
 * 类型、日期和下拉条件选中即生效；文本条件回车生效，生效时一并提交当前草稿。
 * 不同事件的条件只在对应类型的查询中发送。
 */
export function AnalyticsFilterBar({
  characters,
  initialFilters,
  filters,
  onSubmit,
}: {
  characters: CharacterOption[];
  initialFilters: AnalyticsFilters;
  filters: AnalyticsFilters;
  onSubmit: (filters: AnalyticsFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  function apply(next: AnalyticsFilters) {
    setDraft(next);
    onSubmit(next);
  }
  // 清除筛选保留当前埋点类型。
  const clearedFilters = { ...initialFilters, eventName: filters.eventName };
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <SegmentedControl
        label="埋点类型"
        value={draft.eventName}
        options={[
          { value: "conversation.planner", label: "Planner 耗时" },
          { value: "conversation.replyer", label: "Replyer 耗时" },
          { value: "llm.request", label: "LLM 请求" },
          { value: "agent.context_compression", label: "上下文压缩" },
          { value: "app.error", label: "应用错误" },
        ]}
        onChange={(eventName) => apply({ ...draft, eventName })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60">
          <DateRangePicker
            id="analytics-dateRange"
            required
            value={draft}
            onChange={(range) => apply({ ...draft, ...range })}
          />
        </div>
        {draft.eventName !== "llm.request" && draft.eventName !== "app.error" && (
          <CharacterSelect
            characters={characters}
            value={draft.characterId}
            onChange={(characterId) => apply({ ...draft, characterId })}
          />
        )}
        {draft.eventName === "agent.context_compression" && (
          <Select
            value={draft.scene || "__all__"}
            onValueChange={(value) =>
              apply({
                ...draft,
                scene: (value === "__all__" ? "" : value) as AnalyticsFilters["scene"],
              })
            }
          >
            <SelectTrigger className={selectStyle} aria-label="场景">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="__all__">全部场景</SelectItem>
              {Object.entries(compressionSceneLabels).map(([scene, label]) => (
                <SelectItem key={scene} value={scene}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {draft.eventName === "llm.request" ? (
          <>
            <Select
              value={draft.group || "__all__"}
              onValueChange={(value) =>
                apply({ ...draft, group: value === "__all__" ? "" : value })
              }
            >
              <SelectTrigger className={selectStyle} aria-label="模型组">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部模型组</SelectItem>
                {["chat", "flash", "strong", "multimodal", "decision"].map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={draft.status || "__all__"}
              onValueChange={(value) =>
                apply({
                  ...draft,
                  status: (value === "__all__" ? "" : value) as AnalyticsFilters["status"],
                })
              }
            >
              <SelectTrigger className={selectStyle} aria-label="结果">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部结果</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="timeout">超时</SelectItem>
                <SelectItem value="cancelled">取消</SelectItem>
              </SelectContent>
            </Select>
            <input
              className={inputStyle}
              aria-label="模型"
              value={draft.model}
              placeholder="完整模型名"
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <input
              className={inputStyle}
              aria-label="供应商"
              value={draft.host}
              placeholder="接口域名"
              onChange={(event) => setDraft({ ...draft, host: event.target.value })}
            />
          </>
        ) : draft.eventName === "app.error" ? (
          <>
            <input
              className={inputStyle}
              aria-label="应用"
              value={draft.app}
              placeholder="完整应用名"
              onChange={(event) => setDraft({ ...draft, app: event.target.value })}
            />
            <input
              className={inputStyle}
              aria-label="错误类型"
              value={draft.errorType}
              placeholder="完整错误类型"
              onChange={(event) => setDraft({ ...draft, errorType: event.target.value })}
            />
          </>
        ) : (
          <input
            className={inputStyle}
            aria-label="群聊"
            value={draft.channelId}
            placeholder="QQ 群号"
            onChange={(event) => setDraft({ ...draft, channelId: event.target.value })}
          />
        )}
        {/* 多个文本框时浏览器不会隐式提交，需要一个提交按钮承接回车 */}
        <button type="submit" tabIndex={-1} className="sr-only">
          应用筛选
        </button>
        {JSON.stringify(filters) !== JSON.stringify(clearedFilters) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => apply(clearedFilters)}
          >
            <X aria-hidden="true" />
            清除筛选
          </Button>
        )}
      </div>
    </form>
  );
}

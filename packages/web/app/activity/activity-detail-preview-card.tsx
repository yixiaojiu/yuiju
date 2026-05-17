import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ActivityItem } from "./activity-data";

type ActivityDetailPreviewCardProps = {
  event?: ActivityItem;
};

/**
 * 动态详情预览卡片。
 *
 * 说明：
 * - 展示的是 MemoryEpisode 派生后的明细字段，而不是旧行为记录占位文案；
 * - 同时保留 payloadPreview，便于调试复杂事件结构。
 */
export function ActivityDetailPreviewCard({ event }: ActivityDetailPreviewCardProps) {
  if (!event) {
    return (
      <Card>
        <div className="p-[14px] grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-[14px] font-black">详情预览</h3>
          </div>

          <div className="m-3 p-3 rounded-xl border border-dashed border-[rgba(217,230,245,0.85)] bg-[rgba(247,251,255,0.6)] text-[12px] text-[#6b7480]">
            暂无可预览的详情。
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-[14px] grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-[14px] font-black">详情预览</h3>
          <span className="text-[12px] text-[#6b7480]">{event.episodeType}</span>
        </div>

        <div className="grid gap-2">
          {event.detailFields.map((field) => (
            <div
              key={`${event.id}-${field.label}`}
              className="grid grid-cols-[84px_1fr] gap-3 rounded-xl border border-[rgba(217,230,245,0.85)] bg-[rgba(247,251,255,0.78)] px-3 py-2"
            >
              <span className="text-[12px] text-[#6b7480]">{field.label}</span>
              <span className="text-[12px] text-[rgba(43,47,54,0.92)] whitespace-pre-wrap break-all">
                {field.value}
              </span>
            </div>
          ))}
        </div>

        <Collapsible>
          <div className="grid min-w-0 gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[#6b7480]">原始 payload 预览</span>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="group text-[#6b7480]"
                  aria-label="折叠或展开原始 payload 预览"
                >
                  <span className="group-data-[state=open]:hidden">展开</span>
                  <span className="hidden group-data-[state=open]:inline">收起</span>
                  <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="min-w-0">
              <pre className="m-0 max-h-[360px] min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-xl border border-[rgba(217,230,245,0.85)] bg-[rgba(247,251,255,0.85)] p-3 text-[12px] text-[rgba(43,47,54,0.85)]">
                {event.payloadPreview}
              </pre>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    </Card>
  );
}

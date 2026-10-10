import { useState } from "react";
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

export type ActivityFilters = {
  startDate: string;
  endDate: string;
  action: string;
  keyword: string;
};
const inputStyle =
  "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm text-foreground";

/** 草稿只在提交时生效，编辑筛选条件不会连续发出查询。 */
export function ActivityFilterCard({
  actions,
  onSubmit,
}: {
  actions: string[];
  onSubmit: (filters: ActivityFilters) => void;
}) {
  const initial = { startDate: "", endDate: "", action: "", keyword: "" };
  const [draft, setDraft] = useState<ActivityFilters>(initial);
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
            htmlFor="activity-dateRange"
            className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2"
          >
            日期范围
            <DateRangePicker
              id="activity-dateRange"
              value={draft}
              onChange={(range) => setDraft({ ...draft, ...range })}
            />
          </label>
          <label htmlFor="activity-action" className="grid gap-1.5 text-xs text-muted-foreground">
            活动
            <Select
              value={draft.action || "__all__"}
              onValueChange={(value) =>
                setDraft({ ...draft, action: value === "__all__" ? "" : value })
              }
            >
              <SelectTrigger id="activity-action" className={inputStyle} aria-label="活动">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部</SelectItem>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            关键词
            <input
              className={inputStyle}
              value={draft.keyword}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(initial);
              onSubmit(initial);
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

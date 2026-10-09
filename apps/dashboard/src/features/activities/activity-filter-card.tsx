import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type ActivityFilters = {
  startDate: string;
  endDate: string;
  action: string;
  keyword: string;
};
const inputStyle = "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";

/** 草稿只在提交时生效，编辑筛选条件不会连续发出查询。 */
export function ActivityFilterCard({
  initialDate,
  actions,
  onSubmit,
}: {
  initialDate: string;
  actions: string[];
  onSubmit: (filters: ActivityFilters) => void;
}) {
  const initial = { startDate: initialDate, endDate: initialDate, action: "", keyword: "" };
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
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            开始日期
            <input
              className={inputStyle}
              type="date"
              required
              max={draft.endDate}
              value={draft.startDate}
              onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            结束日期
            <input
              className={inputStyle}
              type="date"
              required
              min={draft.startDate}
              value={draft.endDate}
              onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            活动
            <select
              className={inputStyle}
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            >
              <option value="">全部</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
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

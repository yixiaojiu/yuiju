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
import { SearchInput } from "@/components/search-input";

export type ActivityFilters = {
  startDate: string;
  endDate: string;
  action: string;
  keyword: string;
};
export const initialActivityFilters: ActivityFilters = {
  startDate: "",
  endDate: "",
  action: "",
  keyword: "",
};

/** 日期与活动选中即生效；关键词回车生效，生效时一并提交当前草稿。 */
export function ActivityFilterBar({
  actions,
  filters,
  onSubmit,
}: {
  actions: string[];
  filters: ActivityFilters;
  onSubmit: (filters: ActivityFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  function apply(next: ActivityFilters) {
    setDraft(next);
    onSubmit(next);
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="w-full sm:w-60">
        <DateRangePicker
          id="activity-dateRange"
          value={draft}
          onChange={(range) => apply({ ...draft, ...range })}
        />
      </div>
      <Select
        value={draft.action || "__all__"}
        onValueChange={(value) => apply({ ...draft, action: value === "__all__" ? "" : value })}
      >
        <SelectTrigger className="w-40 rounded-lg bg-card" aria-label="活动">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="__all__">全部活动</SelectItem>
          {actions.map((action) => (
            <SelectItem key={action} value={action}>
              {action}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SearchInput
        className="w-full sm:w-56"
        aria-label="关键词"
        placeholder="搜索描述，回车确认"
        value={draft.keyword}
        onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
      />
      {(filters.startDate || filters.action || filters.keyword) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => apply(initialActivityFilters)}
        >
          <X aria-hidden="true" />
          清除筛选
        </Button>
      )}
    </form>
  );
}

import type { MonitoringAlert } from "@yuiju/shared/monitoring/storage";
import { Button } from "@yuiju/shared/ui/components/button";
import { DateRangePicker } from "@yuiju/shared/ui/components/date-picker";
import { X } from "lucide-react";
import { useState } from "react";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { SearchInput } from "@/components/search-input";
import { SegmentedControl } from "@/components/segmented-control";

export type AlertsFilters = {
  startDate: string;
  endDate: string;
  characterId: string;
  monitorKey: string;
  severity: MonitoringAlert["severity"] | "";
};

/** 默认查询所有来源，保证不归属角色的应用告警也能被看到；检测项回车生效。 */
export function AlertsFilterBar({
  characters,
  initialFilters,
  filters,
  onSubmit,
}: {
  characters: CharacterOption[];
  initialFilters: AlertsFilters;
  filters: AlertsFilters;
  onSubmit: (filters: AlertsFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  function apply(next: AlertsFilters) {
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
          id="alerts-dateRange"
          required
          value={draft}
          onChange={(range) => apply({ ...draft, ...range })}
        />
      </div>
      <SegmentedControl
        label="级别"
        value={draft.severity || "all"}
        options={[
          { value: "all", label: "全部" },
          { value: "error", label: "错误" },
          { value: "warning", label: "警告" },
        ]}
        onChange={(value) => apply({ ...draft, severity: value === "all" ? "" : value })}
      />
      {characters.length > 1 && (
        <CharacterSelect
          characters={[{ id: "__all__", name: "全部角色" }, ...characters]}
          value={draft.characterId || "__all__"}
          onChange={(value) => apply({ ...draft, characterId: value === "__all__" ? "" : value })}
        />
      )}
      <SearchInput
        className="w-full sm:w-56"
        aria-label="检测项"
        placeholder="完整检测项标识，回车确认"
        value={draft.monitorKey}
        onChange={(event) => setDraft({ ...draft, monitorKey: event.target.value })}
      />
      {JSON.stringify(filters) !== JSON.stringify(initialFilters) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => apply(initialFilters)}
        >
          <X aria-hidden="true" />
          清除筛选
        </Button>
      )}
    </form>
  );
}

import type { MonitoringAlert } from "@yuiju/shared/monitoring/storage";
import { Button } from "@yuiju/shared/ui/components/button";
import { Card } from "@yuiju/shared/ui/components/card";
import { DateRangePicker } from "@yuiju/shared/ui/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";
import { useState } from "react";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";

export type AlertsFilters = {
  startDate: string;
  endDate: string;
  characterId: string;
  monitorKey: string;
  severity: MonitoringAlert["severity"] | "";
};

/** 默认查询所有来源，保证不归属角色的应用告警也能被看到。 */
export function AlertsFilterCard({
  characters,
  initialFilters,
  onSubmit,
}: {
  characters: CharacterOption[];
  initialFilters: AlertsFilters;
  onSubmit: (filters: AlertsFilters) => void;
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
            htmlFor="alerts-dateRange"
            className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2"
          >
            日期范围
            <DateRangePicker
              id="alerts-dateRange"
              required
              value={draft}
              onChange={(range) => setDraft({ ...draft, ...range })}
            />
          </label>
          {characters.length > 1 && (
            <div className="grid content-start gap-1.5 text-xs text-muted-foreground">
              角色
              <CharacterSelect
                characters={[{ id: "__all__", name: "全部角色" }, ...characters]}
                value={draft.characterId || "__all__"}
                onChange={(value) =>
                  setDraft({ ...draft, characterId: value === "__all__" ? "" : value })
                }
              />
            </div>
          )}
          <label htmlFor="alerts-severity" className="grid gap-1.5 text-xs text-muted-foreground">
            级别
            <Select
              value={draft.severity || "__all__"}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  severity: value === "__all__" ? "" : (value as MonitoringAlert["severity"]),
                })
              }
            >
              <SelectTrigger id="alerts-severity" className="w-full" aria-label="级别">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__all__">全部</SelectItem>
                <SelectItem value="warning">警告</SelectItem>
                <SelectItem value="error">错误</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label htmlFor="alerts-monitorKey" className="grid gap-1.5 text-xs text-muted-foreground">
            检测项
            <input
              id="alerts-monitorKey"
              className="h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm text-foreground"
              value={draft.monitorKey}
              placeholder="完整检测项标识"
              onChange={(event) => setDraft({ ...draft, monitorKey: event.target.value })}
            />
          </label>
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

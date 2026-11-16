"use client";

import type { ExperienceDocument } from "@yuiju/shared/dashboard/types";
import { Button } from "@yuiju/shared/ui/components/button";
import { DateRangePicker } from "@yuiju/shared/ui/components/date-picker";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yuiju/shared/ui/components/sheet";
import { X } from "lucide-react";
import { useState } from "react";
import type {
  ExperienceSummary,
  ExperiencesResponse,
} from "@/app/api/[[...route]]/routes/memories";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { SearchInput } from "@/components/search-input";
import { SegmentedControl } from "@/components/segmented-control";
import { TablePagination } from "@/components/table-pagination";
import { useQuery } from "@/lib/use-query";

const grains = { day: "日", week: "周", month: "月", year: "年" };
const initialFilters = { startDate: "", endDate: "", grain: "day", keyword: "" };

/** 全文只在打开抽屉时查询，不随分页列表一起加载。 */
function ExperienceContent({ id, characterId }: { id: string; characterId: string }) {
  const { data, error } = useQuery<ExperienceDocument>(
    `/api/memories/experiences/${encodeURIComponent(id)}?${new URLSearchParams({ characterId })}`,
  );
  return data ? (
    <MonacoEditorPanel language="markdown" value={data.text} />
  ) : (
    <QueryState error={error} />
  );
}

/** 日期与周期选中即生效；关键词回车生效，生效时一并提交当前草稿。 */
export function ExperiencesPanel({ characterId }: { characterId: string }) {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ExperienceSummary | null>(null);
  const params = new URLSearchParams({ characterId, page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }
  const { data, error } = useQuery<ExperiencesResponse>(`/api/memories/experiences?${params}`);
  function apply(next: typeof initialFilters) {
    setDraft(next);
    setFilters(next);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <SegmentedControl
          label="记忆周期"
          value={draft.grain || "all"}
          options={[
            { value: "all", label: "全部" },
            ...Object.entries(grains).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(value) => apply({ ...draft, grain: value === "all" ? "" : value })}
        />
        <div className="w-full sm:w-60">
          <DateRangePicker
            id="memory-dateRange"
            value={draft}
            onChange={(range) => apply({ ...draft, ...range })}
          />
        </div>
        <SearchInput
          className="w-full sm:w-56"
          aria-label="关键词"
          placeholder="搜索内容，回车确认"
          value={draft.keyword}
          onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
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

      {!data ? (
        <QueryState error={error} />
      ) : data.memories.length === 0 ? (
        <QueryState empty />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <ul className="divide-y">
            {data.memories.map((memory) => (
              <li key={memory.id}>
                <button
                  type="button"
                  onClick={() => setSelected(memory)}
                  className="w-full px-5 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-accent px-2 py-0.5 font-medium">
                      {grains[memory.grain]}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {memory.startDate}
                      {memory.startDate !== memory.endDate && ` — ${memory.endDate}`}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 break-words text-sm leading-6">
                    {memory.excerpt}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <TablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
        </div>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl" aria-describedby={undefined}>
          {selected && (
            <>
              <SheetHeader className="pr-12">
                <SheetTitle>
                  {selected.startDate}
                  {selected.startDate !== selected.endDate && ` — ${selected.endDate}`}
                  {` · ${grains[selected.grain]}记忆`}
                </SheetTitle>
              </SheetHeader>
              <div className="min-w-0 px-4 pb-4">
                <ExperienceContent characterId={characterId} key={selected.id} id={selected.id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

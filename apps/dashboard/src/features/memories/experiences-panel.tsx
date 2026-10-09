"use client";

import type { ExperienceDocument } from "@yuiju/shared/dashboard/types";
import { useState } from "react";
import type { ExperienceSummary, ExperiencesResponse } from "@/api/memories";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQuery } from "@/lib/use-query";

const grains = { day: "日", week: "周", month: "月", year: "年" };
const initialFilters = { startDate: "", endDate: "", grain: "day", keyword: "" };
const inputStyle = "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";

/** 全文只在打开抽屉时查询，不随分页列表一起加载。 */
function ExperienceContent({ id }: { id: string }) {
  const { data, error } = useQuery<ExperienceDocument>(
    `/api/memories/experiences/${encodeURIComponent(id)}`,
  );
  return data ? (
    <MonacoEditorPanel language="markdown" value={data.text} />
  ) : (
    <QueryState error={error} />
  );
}

export function ExperiencesPanel() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ExperienceSummary | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }
  const { data, error } = useQuery<ExperiencesResponse>(`/api/memories/experiences?${params}`);

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl p-3.5">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draft);
            setPage(1);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              开始日期
              <input
                className={inputStyle}
                type="date"
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
                min={draft.startDate}
                value={draft.endDate}
                onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              记忆周期
              <select
                className={inputStyle}
                value={draft.grain}
                onChange={(event) => setDraft({ ...draft, grain: event.target.value })}
              >
                <option value="">全部</option>
                {Object.entries(grains).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
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
                setDraft(initialFilters);
                setFilters(initialFilters);
                setPage(1);
              }}
            >
              重置
            </Button>
            <Button type="submit">查询</Button>
          </div>
        </form>
      </Card>

      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                {["日期", "周期", "内容摘要", "操作"].map((title) => (
                  <th key={title} className="whitespace-nowrap px-4 py-3 font-medium">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td
                    colSpan={4}
                    className={`p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                    role={error ? "alert" : "status"}
                  >
                    {error || "加载中…"}
                  </td>
                </tr>
              ) : data.memories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-10 text-center text-muted-foreground">
                    暂无记录
                  </td>
                </tr>
              ) : (
                data.memories.map((memory) => (
                  <tr key={memory.id} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                      {memory.startDate}
                      {memory.startDate !== memory.endDate && ` — ${memory.endDate}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 align-top">
                      {grains[memory.grain]}
                    </td>
                    <td className="min-w-64 px-4 py-4 align-top text-xs leading-6 text-muted-foreground">
                      <p className="line-clamp-2 break-words">{memory.excerpt}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(memory)}>
                        查看
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-3.5">
            <span className="text-xs text-muted-foreground">
              共 {data.total} 条 · 第 {data.page} /{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={data.page === 1}
                onClick={() => setPage(data.page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => setPage(data.page + 1)}
              >
                下一页
              </Button>
            </div>
          </footer>
        )}
      </Card>

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
                <ExperienceContent key={selected.id} id={selected.id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

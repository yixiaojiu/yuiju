"use client";

import type { ExperienceDocument } from "@yuiju/shared/dashboard/types";
import { useState } from "react";
import type {
  ExperienceSummary,
  ExperiencesResponse,
} from "@/app/api/[[...route]]/routes/memories";
import { MonacoEditorPanel } from "@/components/monaco-editor-panel";
import { QueryState } from "@/components/query-state";
import { TablePagination } from "@/components/table-pagination";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@/lib/use-query";

const grains = { day: "日", week: "周", month: "月", year: "年" };
const initialFilters = { startDate: "", endDate: "", grain: "day", keyword: "" };
const inputStyle =
  "h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm text-foreground";

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
            <label
              htmlFor="memory-dateRange"
              className="grid gap-1.5 text-xs text-muted-foreground sm:col-span-2"
            >
              日期范围
              <DateRangePicker
                id="memory-dateRange"
                value={draft}
                onChange={(range) => setDraft({ ...draft, ...range })}
              />
            </label>
            <label htmlFor="memory-grain" className="grid gap-1.5 text-xs text-muted-foreground">
              记忆周期
              <Select
                value={draft.grain || "__all__"}
                onValueChange={(value) =>
                  setDraft({ ...draft, grain: value === "__all__" ? "" : value })
                }
              >
                <SelectTrigger id="memory-grain" className={inputStyle} aria-label="记忆周期">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__all__">全部</SelectItem>
                  {Object.entries(grains).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
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
        <Table className="w-full text-left text-sm">
          <TableHeader className="border-b bg-secondary/50 text-xs text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              {["日期", "周期", "内容摘要", "操作"].map((title) => (
                <TableHead
                  key={title}
                  className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground"
                >
                  {title}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={4}
                  className={`whitespace-normal p-10 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
                  role={error ? "alert" : "status"}
                >
                  {error || "加载中…"}
                </TableCell>
              </TableRow>
            ) : data.memories.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="p-10 text-center text-muted-foreground">
                  暂无记录
                </TableCell>
              </TableRow>
            ) : (
              data.memories.map((memory) => (
                <TableRow key={memory.id} className="border-b last:border-0 hover:bg-secondary/30">
                  <TableCell className="whitespace-nowrap px-4 py-4 align-top text-xs tabular-nums">
                    {memory.startDate}
                    {memory.startDate !== memory.endDate && ` — ${memory.endDate}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-4 align-top">
                    {grains[memory.grain]}
                  </TableCell>
                  <TableCell className="min-w-64 whitespace-normal px-4 py-4 align-top text-xs leading-6 text-muted-foreground">
                    <p className="line-clamp-2 break-words">{memory.excerpt}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3 align-top">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(memory)}>
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {data && (
          <TablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
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

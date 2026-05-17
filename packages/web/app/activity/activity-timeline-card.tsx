"use client";

import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type ActivityEpisodeTypeFilter,
  type ActivityItem,
  type ActivityPagination,
  type ActivityQueryFilters,
  type ActivityTriggerFilter,
  DEFAULT_ACTIVITY_QUERY_FILTERS,
} from "./activity-data";

interface ActivityTimelineCardProps {
  events?: ActivityItem[];
  pagination?: ActivityPagination;
  filters: ActivityQueryFilters;
  isLoading: boolean;
  errorMessage?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onFilterSubmit: (filters: ActivityQueryFilters) => void;
  onPageChange: (page: number) => void;
}

const parseDate = (value: string): Date | undefined => {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map((item) => Number.parseInt(item, 10));
  if (!year || !month || !day) return undefined;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
};

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 动态时间线卡片。
 *
 * 说明：
 * - 所有筛选都基于 Episode 派生数据进行，不再假设只有行为事件；
 * - 通过 selectedId / onSelect 与右侧详情卡片联动，避免组件内部维护重复状态。
 */
export function ActivityTimelineCard({
  events,
  pagination,
  filters,
  isLoading,
  errorMessage,
  selectedId,
  onSelect,
  onFilterSubmit,
  onPageChange,
}: ActivityTimelineCardProps) {
  const [startDate, setStartDate] = useState(filters.startDate);
  const [endDate, setEndDate] = useState(filters.endDate);
  const [trigger, setTrigger] = useState<ActivityTriggerFilter>(filters.trigger);
  const [episodeType, setEpisodeType] = useState<ActivityEpisodeTypeFilter>(filters.episodeType);
  const [keywordInput, setKeywordInput] = useState(filters.keyword);

  useEffect(() => {
    setStartDate(filters.startDate);
    setEndDate(filters.endDate);
    setTrigger(filters.trigger);
    setEpisodeType(filters.episodeType);
    setKeywordInput(filters.keyword);
  }, [filters]);

  const displayEvents = useMemo(() => (events && events.length > 0 ? events : []), [events]);

  const dateRange = useMemo<DateRange | undefined>(() => {
    const from = parseDate(startDate);
    const to = parseDate(endDate);
    if (!from && !to) return undefined;
    return { from, to };
  }, [endDate, startDate]);

  const submitFilters = () => {
    onFilterSubmit({
      startDate,
      endDate,
      trigger,
      episodeType,
      keyword: keywordInput.trim(),
    });
  };

  const resetFilters = () => {
    setStartDate(DEFAULT_ACTIVITY_QUERY_FILTERS.startDate);
    setEndDate(DEFAULT_ACTIVITY_QUERY_FILTERS.endDate);
    setTrigger(DEFAULT_ACTIVITY_QUERY_FILTERS.trigger);
    setEpisodeType(DEFAULT_ACTIVITY_QUERY_FILTERS.episodeType);
    setKeywordInput("");
    onFilterSubmit(DEFAULT_ACTIVITY_QUERY_FILTERS);
  };

  const hasActiveFilters =
    startDate !== DEFAULT_ACTIVITY_QUERY_FILTERS.startDate ||
    endDate !== DEFAULT_ACTIVITY_QUERY_FILTERS.endDate ||
    trigger !== DEFAULT_ACTIVITY_QUERY_FILTERS.trigger ||
    episodeType !== DEFAULT_ACTIVITY_QUERY_FILTERS.episodeType ||
    keywordInput.trim().length > 0;

  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;
  const pageItems = buildVisiblePageItems(currentPage, totalPages);

  return (
    <Card className="min-w-0">
      <div className="grid min-w-0 gap-3 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-[14px] font-black">动态时间线</h3>
        </div>

        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[12px] text-[#6b7480]">日期范围</span>
            <DateRangePicker
              value={dateRange}
              className="min-w-0"
              onChange={(next) => {
                setStartDate(next?.from ? formatDate(next.from) : "");
                setEndDate(next?.to ? formatDate(next.to) : "");
              }}
            />
          </div>

          <div className="grid min-w-0 gap-[6px]">
            <label className="text-[12px] text-[#6b7480]" htmlFor="trigger">
              触发来源
            </label>
            <Select
              value={trigger}
              onValueChange={(value: string) => setTrigger(value as ActivityTriggerFilter)}
            >
              <SelectTrigger id="trigger" aria-label="选择触发来源">
                <SelectValue placeholder="选择触发来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="agent">agent</SelectItem>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="system">system</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid min-w-0 gap-[6px]">
            <label className="text-[12px] text-[#6b7480]" htmlFor="episodeType">
              事件类型
            </label>
            <Select
              value={episodeType}
              onValueChange={(value: string) => setEpisodeType(value as ActivityEpisodeTypeFilter)}
            >
              <SelectTrigger id="episodeType" aria-label="选择事件类型">
                <SelectValue placeholder="选择事件类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="behavior">behavior</SelectItem>
                <SelectItem value="conversation">conversation</SelectItem>
                <SelectItem value="plan_created">plan_created</SelectItem>
                <SelectItem value="plan_updated">plan_updated</SelectItem>
                <SelectItem value="plan_completed">plan_completed</SelectItem>
                <SelectItem value="plan_abandoned">plan_abandoned</SelectItem>
                <SelectItem value="system">system</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid min-w-0 gap-[6px]">
            <label className="text-[12px] text-[#6b7480]" htmlFor="keyword">
              关键词搜索
            </label>
            <Input
              id="keyword"
              placeholder="输入标题、摘要或详情字段"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitFilters();
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:[&_button]:w-full">
          <Button type="button" size="sm" className="cursor-pointer" onClick={submitFilters}>
            搜索
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="cursor-pointer disabled:cursor-not-allowed"
            disabled={!hasActiveFilters}
            onClick={resetFilters}
          >
            重置
          </Button>
        </div>

        <div className="relative pl-[18px] grid gap-3 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[rgba(145,196,238,0.6)] before:rounded-full">
          {errorMessage ? (
            <div className="rounded-2xl border border-[rgba(240,180,180,0.85)] bg-[rgba(255,246,246,0.9)] p-3 text-[13px] text-[#8b4a4a]">
              {errorMessage}
            </div>
          ) : isLoading && displayEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[rgba(217,230,245,0.9)] bg-[rgba(247,251,255,0.78)] p-3 text-[13px] text-[#6b7480]">
              正在加载动态...
            </div>
          ) : displayEvents.length === 0 ? (
            <div className="rounded-2xl border border-[rgba(217,230,245,0.9)] bg-[rgba(255,255,255,0.84)] shadow-[0_10px_25px_rgba(21,33,54,0.06)] p-3 text-[13px] text-[#6b7480]">
              没有匹配的记录，试试调整筛选条件。
            </div>
          ) : (
            displayEvents.map((item) => {
              const tone =
                item.trigger === "agent"
                  ? "bg-[rgba(145,196,238,0.18)] border-[rgba(145,196,238,0.3)] text-[#2b2f36]"
                  : item.trigger === "user"
                    ? "bg-[rgba(250,227,190,0.75)] border-[rgba(250,227,190,0.85)] text-[#2b2f36]"
                    : "bg-[rgba(175,122,197,0.14)] border-[rgba(175,122,197,0.25)] text-[#2b2f36]";
              const isSelected = selectedId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect?.(item.id)}
                  className={cn(
                    "relative text-left rounded-2xl border bg-[rgba(255,255,255,0.84)] shadow-[0_10px_25px_rgba(21,33,54,0.06)] p-3 grid gap-2 before:content-[''] before:absolute before:-left-3.5 before:top-[18px] before:w-2.5 before:h-2.5 before:rounded-full before:bg-[rgba(145,196,238,0.9)] before:border-2 before:border-[rgba(247,251,255,1)] transition-colors",
                    isSelected
                      ? "border-[rgba(145,196,238,0.95)] ring-2 ring-[rgba(145,196,238,0.25)]"
                      : "border-[rgba(217,230,245,0.9)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 flex-wrap">
                      <h3 className="m-0 text-[14px] font-black">{item.title}</h3>
                      <Badge variant="soft" size="sm" className={cn("px-[10px] py-[7px]", tone)}>
                        {item.trigger}
                      </Badge>
                      <Badge
                        variant="soft"
                        size="sm"
                        className="border-[rgba(217,230,245,0.9)] bg-[rgba(247,251,255,0.9)] text-[#6b7480]"
                      >
                        {item.episodeType}
                      </Badge>
                    </div>
                    <span className="text-[12px] text-[#6b7480]">
                      {item.timeLabel} · {item.durationMinutes}min
                    </span>
                  </div>

                  <p className="m-0 text-[13px] text-[#6b7480]">{item.summary}</p>

                  <div className="flex items-center justify-between gap-3 text-[12px] text-[#6b7480]">
                    <span>{item.dateLabel}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[rgba(217,230,245,0.85)] pt-3 max-[640px]:flex-col max-[640px]:items-stretch">
          <div className="text-[13px] text-[#6b7480]">
            第 {currentPage} / {totalPages} 页{pagination ? ` · 共 ${pagination.total} 条` : ""}
          </div>

          <Pagination className="mx-0 w-auto justify-end max-[640px]:justify-center">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  className={cn(
                    !pagination?.hasPrevPage || isLoading
                      ? "pointer-events-none opacity-50"
                      : "cursor-pointer",
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!pagination?.hasPrevPage || isLoading) return;
                    onPageChange(currentPage - 1);
                  }}
                />
              </PaginationItem>

              {pageItems.map((item) =>
                item === "ellipsis-left" || item === "ellipsis-right" ? (
                  <PaginationItem key={item}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      href="#"
                      isActive={item === currentPage}
                      onClick={(event) => {
                        event.preventDefault();
                        if (item === currentPage || isLoading) return;
                        onPageChange(item);
                      }}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}

              <PaginationItem>
                <PaginationNext
                  href="#"
                  className={cn(
                    !pagination?.hasNextPage || isLoading
                      ? "pointer-events-none opacity-50"
                      : "cursor-pointer",
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!pagination?.hasNextPage || isLoading) return;
                    onPageChange(currentPage + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
    </Card>
  );
}

function buildVisiblePageItems(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis-left",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ];
}

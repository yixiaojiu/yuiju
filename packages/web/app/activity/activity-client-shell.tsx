"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ActivityCareCard } from "./activity-care-card";
import {
  type ActivityEpisodeTypeFilter,
  type ActivityQueryFilters,
  type ActivityResponsePayload,
  type ActivityTriggerFilter,
  DEFAULT_ACTIVITY_QUERY_FILTERS,
} from "./activity-data";
import { ActivityDetailPreviewCard } from "./activity-detail-preview-card";
import { ActivityTimelineCard } from "./activity-timeline-card";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

const fetchActivityPayload = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as ActivityResponsePayload & {
    code?: number;
    message?: string;
  };

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message ?? "动态加载失败");
  }

  return payload;
};

const parseCurrentPage = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE;
  return parsed;
};

const parseDateParam = (value: string | null) => {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
};

const parseTriggerFilter = (value: string | null): ActivityTriggerFilter => {
  if (value === "agent" || value === "user" || value === "system") return value;
  return DEFAULT_ACTIVITY_QUERY_FILTERS.trigger;
};

const parseEpisodeTypeFilter = (value: string | null): ActivityEpisodeTypeFilter => {
  if (
    value === "behavior" ||
    value === "conversation" ||
    value === "plan_created" ||
    value === "plan_updated" ||
    value === "plan_completed" ||
    value === "plan_abandoned" ||
    value === "system"
  ) {
    return value;
  }
  return DEFAULT_ACTIVITY_QUERY_FILTERS.episodeType;
};

type ActivityClientShellProps = {
  showCareCard: boolean;
};

/**
 * 动态页客户端壳组件。
 *
 * 说明：
 * - 查询页码统一写入 URL，便于刷新、分享和前进后退；
 * - 页面数据完全依赖 nodejs API，避免客户端直接接触数据库模型。
 */
export function ActivityClientShell({ showCareCard }: ActivityClientShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPage = parseCurrentPage(searchParams.get("page"));
  const filters = useMemo<ActivityQueryFilters>(
    () => ({
      startDate: parseDateParam(searchParams.get("startDate")),
      endDate: parseDateParam(searchParams.get("endDate")),
      trigger: parseTriggerFilter(searchParams.get("trigger")),
      episodeType: parseEpisodeTypeFilter(searchParams.get("episodeType")),
      keyword: searchParams.get("keyword")?.trim() ?? "",
    }),
    [searchParams],
  );

  const apiPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    params.set("pageSize", String(DEFAULT_PAGE_SIZE));
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.trigger !== DEFAULT_ACTIVITY_QUERY_FILTERS.trigger) {
      params.set("trigger", filters.trigger);
    }
    if (filters.episodeType !== DEFAULT_ACTIVITY_QUERY_FILTERS.episodeType) {
      params.set("episodeType", filters.episodeType);
    }
    if (filters.keyword) params.set("keyword", filters.keyword);
    return `/api/nodejs/activity/activity?${params.toString()}`;
  }, [currentPage, filters]);

  const { data, error, isLoading, isValidating } = useSWR(apiPath, fetchActivityPayload, {
    keepPreviousData: true,
  });
  const events = data?.data?.events;
  const pagination = data?.data?.pagination;
  const isBusy = isLoading || isValidating;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(events?.[0]?.id ?? null);
  }, [events]);

  const selectedEvent = useMemo(
    () => events?.find((item) => item.id === selectedId) ?? events?.[0],
    [events, selectedId],
  );

  const handlePageChange = (page: number) => {
    if (page < 1 || page === currentPage) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const handleFilterSubmit = (nextFilters: ActivityQueryFilters) => {
    const params = new URLSearchParams();
    params.set("page", String(DEFAULT_PAGE));
    if (nextFilters.startDate) params.set("startDate", nextFilters.startDate);
    if (nextFilters.endDate) params.set("endDate", nextFilters.endDate);
    if (nextFilters.trigger !== DEFAULT_ACTIVITY_QUERY_FILTERS.trigger) {
      params.set("trigger", nextFilters.trigger);
    }
    if (nextFilters.episodeType !== DEFAULT_ACTIVITY_QUERY_FILTERS.episodeType) {
      params.set("episodeType", nextFilters.episodeType);
    }
    const keyword = nextFilters.keyword.trim();
    if (keyword) params.set("keyword", keyword);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="grid grid-cols-[1fr_360px] max-[1020px]:grid-cols-1 gap-[14px] items-start mt-4.5">
      <ActivityTimelineCard
        events={events}
        isLoading={isBusy}
        errorMessage={error instanceof Error ? error.message : undefined}
        pagination={pagination}
        filters={filters}
        selectedId={selectedEvent?.id ?? null}
        onSelect={setSelectedId}
        onFilterSubmit={handleFilterSubmit}
        onPageChange={handlePageChange}
      />
      <div className="grid gap-[14px]">
        {showCareCard ? <ActivityCareCard /> : null}
        <ActivityDetailPreviewCard event={selectedEvent} />
      </div>
    </div>
  );
}

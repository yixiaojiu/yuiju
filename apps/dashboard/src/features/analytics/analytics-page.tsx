"use client";

import { useEffect, useState } from "react";
import type { AnalyticsResponse } from "@/app/api/[[...route]]/routes/analytics";
import type { CharacterOption } from "@/components/character-select";
import { AnalyticsFilterCard, type AnalyticsFilters } from "./analytics-filter-card";
import { AnalyticsSummaryCards, CompressionDailyTable } from "./analytics-summary";
import { AnalyticsTableCard } from "./analytics-table-card";

type AnalyticsQuery = { filters: AnalyticsFilters; page: number };

export function AnalyticsPage({
  initialDate,
  characters,
}: {
  initialDate: string;
  characters: CharacterOption[];
}) {
  const [initialFilters] = useState<AnalyticsFilters>({
    eventName: "conversation.planner",
    characterId: characters.length > 0 ? characters[0].id : "",
    startDate: initialDate,
    endDate: initialDate,
    channelId: "",
    group: "",
    model: "",
    host: "",
    status: "",
    scene: "",
    app: "",
    errorType: "",
  });
  const [query, setQuery] = useState<AnalyticsQuery>({ filters: initialFilters, page: 1 });
  const [result, setResult] = useState<{
    query: AnalyticsQuery;
    data?: AnalyticsResponse;
    error?: string;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const { filters, page } = query;
      const params = new URLSearchParams({
        eventName: filters.eventName,
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: String(page),
      });
      if (filters.eventName !== "llm.request" && filters.eventName !== "app.error") {
        params.set("characterId", filters.characterId);
      }
      const fields =
        filters.eventName === "llm.request"
          ? {
              group: filters.group,
              model: filters.model,
              host: filters.host,
              status: filters.status,
            }
          : filters.eventName === "app.error"
            ? { app: filters.app, errorType: filters.errorType }
            : {
                channelId: filters.channelId,
                ...(filters.eventName === "agent.context_compression" && { scene: filters.scene }),
              };
      for (const [key, value] of Object.entries(fields)) {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      }
      try {
        const response = await fetch(`/api/analytics?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error);
        }
        if (!controller.signal.aborted) {
          setResult({ query, data: body });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ query, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    load();
    return () => controller.abort();
  }, [query]);

  // 每次提交生成新的查询对象；相同条件也重新读取，旧响应不能覆盖新查询。
  const current = result?.query === query ? result : undefined;
  return (
    <div className="space-y-3.5">
      <h1 className="mb-5 text-2xl font-bold">埋点</h1>
      <AnalyticsFilterCard
        characters={characters}
        initialFilters={initialFilters}
        onSubmit={(filters) => setQuery({ filters, page: 1 })}
      />
      {current?.data && (
        <AnalyticsSummaryCards eventName={query.filters.eventName} summary={current.data.summary} />
      )}
      {current?.data && query.filters.eventName === "agent.context_compression" && (
        <CompressionDailyTable entries={current.data.compressionDaily} />
      )}
      <AnalyticsTableCard
        key={`${query.filters.eventName}:${query.filters.characterId}`}
        eventName={query.filters.eventName}
        data={current?.data}
        error={current?.error}
        onPageChange={(page) => setQuery({ filters: query.filters, page })}
      />
    </div>
  );
}

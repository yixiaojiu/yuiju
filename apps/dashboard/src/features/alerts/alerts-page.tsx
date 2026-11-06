"use client";

import type { MonitoringAlertsResult } from "@yuiju/shared/monitoring/storage";
import { useEffect, useState } from "react";
import type { CharacterOption } from "@/components/character-select";
import { AlertsFilterCard, type AlertsFilters } from "./alerts-filter-card";
import { AlertsTableCard } from "./alerts-table-card";

export function AlertsPage({
  initialDate,
  characters,
}: {
  initialDate: string;
  characters: CharacterOption[];
}) {
  const [initialFilters] = useState<AlertsFilters>({
    startDate: initialDate,
    endDate: initialDate,
    characterId: "",
    monitorKey: "",
    severity: "",
  });
  const [query, setQuery] = useState({ filters: initialFilters, page: 1 });
  const [result, setResult] = useState<{
    query: typeof query;
    data?: MonitoringAlertsResult;
    error?: string;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const { filters, page } = query;
      const params = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: String(page),
      });
      for (const [key, value] of Object.entries({
        characterId: filters.characterId,
        monitorKey: filters.monitorKey,
        severity: filters.severity,
      })) {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      }
      try {
        const response = await fetch(`/api/alerts?${params}`, {
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

  // 查询对象变化才读取；重复提交同一条件也可刷新，旧响应不能覆盖新查询。
  const current = result?.query === query ? result : undefined;
  return (
    <div className="space-y-3.5">
      <h1 className="mb-5 text-2xl font-bold">告警</h1>
      <AlertsFilterCard
        characters={characters}
        initialFilters={initialFilters}
        onSubmit={(filters) => setQuery({ filters, page: 1 })}
      />
      <AlertsTableCard
        key={JSON.stringify(query)}
        characters={characters}
        data={current?.data}
        error={current?.error}
        onPageChange={(page) => setQuery({ filters: query.filters, page })}
      />
    </div>
  );
}

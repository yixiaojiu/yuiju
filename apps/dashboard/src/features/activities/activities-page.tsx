"use client";

import { useState } from "react";
import type { ActivitiesResponse } from "@/api/activities";
import { useQuery } from "@/lib/use-query";
import { ActivityFilterCard, type ActivityFilters } from "./activity-filter-card";
import { ActivityTableCard } from "./activity-table-card";

export function ActivitiesPage({
  timezone,
  initialDate,
}: {
  timezone: string;
  initialDate: string;
}) {
  const [filters, setFilters] = useState<ActivityFilters>({
    startDate: initialDate,
    endDate: initialDate,
    action: "",
    keyword: "",
  });
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ ...filters, page: String(page) });
  const { data, error } = useQuery<ActivitiesResponse>(`/api/activities?${query}`, 5000);
  return (
    <div className="space-y-3.5">
      <h1 className="mb-5 text-2xl font-bold">活动</h1>
      <ActivityFilterCard
        initialDate={initialDate}
        actions={data ? data.actions : []}
        onSubmit={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <ActivityTableCard data={data} error={error} timezone={timezone} onPageChange={setPage} />
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ActivitiesResponse } from "@/app/api/[[...route]]/routes/activities";
import { useQuery } from "@/lib/use-query";
import { ActivityFilterCard, type ActivityFilters } from "./activity-filter-card";
import { ActivityTableCard } from "./activity-table-card";

export function ActivitiesPage() {
  const [filters, setFilters] = useState<ActivityFilters>({
    startDate: "",
    endDate: "",
    action: "",
    keyword: "",
  });
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      query.set(key, value);
    }
  }
  const { data, error } = useQuery<ActivitiesResponse>(`/api/activities?${query}`, 5000);
  return (
    <div className="space-y-3.5">
      <h1 className="mb-5 text-2xl font-bold">活动</h1>
      <ActivityFilterCard
        actions={data ? data.actions : []}
        onSubmit={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <ActivityTableCard data={data} error={error} onPageChange={setPage} />
    </div>
  );
}

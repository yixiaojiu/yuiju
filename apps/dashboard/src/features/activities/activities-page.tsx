"use client";

import { useState } from "react";
import type { ActivitiesResponse } from "@/app/api/[[...route]]/routes/activities";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { useQuery } from "@/lib/use-query";
import {
  ActivityFilterBar,
  type ActivityFilters,
  initialActivityFilters,
} from "./activity-filter-bar";
import { ActivityList } from "./activity-list";

export function ActivitiesPage({ characters }: { characters: CharacterOption[] }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id);
  if (characterId === undefined) {
    return <p className="text-sm text-muted-foreground">未配置角色</p>;
  }
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">活动</h1>
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </header>
      <ActivitiesQuery key={characterId} characterId={characterId} />
    </div>
  );
}

function ActivitiesQuery({ characterId }: { characterId: string }) {
  const [filters, setFilters] = useState<ActivityFilters>(initialActivityFilters);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ characterId, page: String(page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      query.set(key, value);
    }
  }
  const { data, error } = useQuery<ActivitiesResponse>(`/api/activities?${query}`, 5000);
  return (
    <div className="space-y-4">
      <ActivityFilterBar
        actions={data ? data.actions : []}
        filters={filters}
        onSubmit={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <ActivityList data={data} error={error} onPageChange={setPage} />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ActivitiesResponse } from "@/api/activities";
import type { CharacterStatus } from "@/api/characters";
import { QueryState } from "@/components/query-state";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { HomeStatusCard } from "./home-status-card";
import { HomeWorldState } from "./home-world-state";

/** 角色展示与世界观测各自查询，倒计时只在浏览器内推进。 */
export function HomePage() {
  const { data, error } = useQuery<CharacterStatus>("/api/character", 5000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!data) {
    return <QueryState error={error} />;
  }
  return <HomeContent data={data} now={now} />;
}

function HomeContent({ data, now }: { data: CharacterStatus; now: number }) {
  const date = today(data.timezone);
  const { data: activities, error } = useQuery<ActivitiesResponse>(
    `/api/activities?startDate=${date}&endDate=${date}&page=1`,
    30000,
  );
  return (
    <div className="grid items-start gap-3.5 min-[1020px]:grid-cols-[360px_minmax(0,1fr)]">
      <div className="grid gap-3.5">
        <HomeStatusCard data={data} now={now} todayActions={activities ? activities.actions : []} />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <HomeWorldState timezone={data.timezone} now={now} publicDeployment={data.publicDeployment} />
    </div>
  );
}

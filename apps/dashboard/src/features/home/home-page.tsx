"use client";

import { useEffect, useState } from "react";
import type { ActivitiesResponse } from "@/app/api/[[...route]]/routes/activities";
import type { CharacterStatus } from "@/app/api/[[...route]]/routes/characters";
import type { WorldDashboardStatus } from "@/app/api/[[...route]]/routes/world";
import { type CharacterOption, CharacterSelect } from "@/components/character-select";
import { QueryState } from "@/components/query-state";
import { today } from "@/lib/date";
import { useQuery } from "@/lib/use-query";
import { CalendarSummary } from "../calendar/calendar-summary";
import { HomeStatusCard } from "./home-status-card";
import { HomeWorldInteraction } from "./home-world-interaction";
import { HomeWorldState } from "./home-world-state";

/** 角色展示与世界观测各自查询，倒计时只在浏览器内推进。 */
export function HomePage({ characters }: { characters: CharacterOption[] }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id);
  if (characterId === undefined) {
    return <p className="text-sm text-muted-foreground">未配置角色</p>;
  }
  return (
    <div className="space-y-6">
      <div className="flex justify-end empty:hidden">
        <CharacterSelect characters={characters} value={characterId} onChange={setCharacterId} />
      </div>
      <HomeQuery key={characterId} characterId={characterId} />
    </div>
  );
}

function HomeQuery({ characterId }: { characterId: string }) {
  const { data, error } = useQuery<CharacterStatus>(
    `/api/character?${new URLSearchParams({ characterId })}`,
    5000,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!data) {
    return <QueryState error={error} />;
  }
  return <HomeContent characterId={characterId} data={data} now={now} />;
}

function HomeContent({
  characterId,
  data,
  now,
}: {
  characterId: string;
  data: CharacterStatus;
  now: number;
}) {
  const date = today(data.timezone);
  const { data: activities, error: activitiesError } = useQuery<ActivitiesResponse>(
    `/api/activities?${new URLSearchParams({ characterId, startDate: date, endDate: date, page: "1" })}`,
    30000,
  );
  const { data: world, error: worldError } = useQuery<WorldDashboardStatus>(
    `/api/world?${new URLSearchParams({ characterId })}`,
  );
  return (
    <div className="space-y-6">
      <HomeStatusCard data={data} now={now} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-6">
          {!data.publicDeployment && (
            <CalendarSummary characterId={characterId} timezone={data.timezone} now={now} />
          )}
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold">今日活动</h2>
            {activitiesError ? (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {activitiesError}
              </p>
            ) : activities?.actions.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {activities.actions.map((action) => (
                  <span
                    key={action}
                    className="rounded-full bg-primary/15 px-2.5 py-1 text-xs text-foreground"
                  >
                    {action}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {activities ? "暂无" : "加载中…"}
              </p>
            )}
            {!data.publicDeployment && (
              <>
                <h2 className="mt-6 text-sm font-semibold">当前感受</h2>
                {data.feelings?.length ? (
                  <ul className="mt-3 space-y-3 border-l-2 border-primary/40 pl-3">
                    {data.feelings.map((feeling, index) => (
                      <li
                        key={`${feeling.occurredAt}-${index}`}
                        className="whitespace-pre-wrap text-sm leading-6"
                      >
                        {feeling.content}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">暂无</p>
                )}
              </>
            )}
          </section>
        </div>
        <div className="grid min-w-0 gap-6">
          {world ? (
            <HomeWorldState environment={world.environment} />
          ) : (
            <QueryState error={worldError} />
          )}
          {data.world && (
            <section className="rounded-2xl border bg-card p-5">
              <header className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">背包</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  金钱 {data.world.money}
                </span>
              </header>
              {data.world.inventory.length ? (
                <ul className="mt-3 divide-y text-sm">
                  {data.world.inventory.map((item) => (
                    <li key={item.itemId} className="flex justify-between py-2">
                      <span>{item.name}</span>
                      <span className="text-muted-foreground tabular-nums">× {item.quantity}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">空</p>
              )}
            </section>
          )}
        </div>
      </div>
      {!data.publicDeployment && world?.interaction && (
        <HomeWorldInteraction data={world.interaction} now={now} />
      )}
    </div>
  );
}

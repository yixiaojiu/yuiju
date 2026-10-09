"use client";

import type { WorldDashboardStatus } from "@/api/world";
import { QueryState } from "@/components/query-state";
import { Card } from "@/components/ui/card";
import { HomeWorldInteraction } from "@/features/home/home-world-interaction";
import { formatTime } from "@/lib/date";
import { useQuery } from "@/lib/use-query";

export function HomeWorldState({
  timezone,
  now,
  publicDeployment,
}: {
  timezone: string;
  now: number;
  publicDeployment: boolean;
}) {
  const { data, error } = useQuery<WorldDashboardStatus>("/api/world");
  const environment = data?.environment;

  return (
    <section className="min-w-0 space-y-3.5">
      {!data ? (
        <QueryState error={error} />
      ) : (
        <>
          {!publicDeployment && data.interaction && (
            <HomeWorldInteraction data={data.interaction} timezone={timezone} now={now} />
          )}
          {environment ? (
            <>
              <Card className="gap-3 rounded-2xl p-3.5">
                <h2 className="text-sm font-bold">世界环境</h2>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    ["当前时间", formatTime(now, timezone, true)],
                    ["天气", environment.weather.type],
                    ["体感温度", environment.weather.temperatureLevel],
                    ["天气时段起始", formatTime(environment.weatherPeriod, timezone, true)],
                    ["资源刷新日期", environment.resourceDate],
                    ["环境同步时间", formatTime(environment.updatedAt, timezone, true)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border bg-secondary/50 p-2.5">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1.5 text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="gap-3 rounded-2xl p-3.5">
                <h2 className="text-sm font-bold">地点与资源</h2>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {environment.places.map((place) => (
                    <article
                      key={place.id}
                      className="space-y-3 rounded-xl border bg-secondary/30 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">{place.name}</h3>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${place.isOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                        >
                          {place.isOpen ? "开放" : "关闭"}
                        </span>
                      </div>
                      {place.closed && <p className="text-xs text-destructive">临时关闭</p>}
                      {place.resources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {place.resources.map((resource) => (
                            <span
                              key={resource.name}
                              className="rounded-lg border bg-card px-2 py-1 text-xs"
                            >
                              {resource.name} × {resource.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-6 text-center text-xs text-muted-foreground">暂无世界环境数据</Card>
          )}
        </>
      )}
    </section>
  );
}

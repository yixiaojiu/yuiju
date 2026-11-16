import type { WorldEnvironmentStatus } from "@yuiju/shared/dashboard/types";
import { cn } from "@yuiju/shared/ui/utils";
import { formatTime } from "@/lib/date";

export function HomeWorldState({ environment }: { environment: WorldEnvironmentStatus | null }) {
  if (environment === null) {
    return (
      <section className="rounded-2xl border bg-card p-5 text-xs text-muted-foreground">
        暂无世界环境数据
      </section>
    );
  }
  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">世界</h2>
        <span className="text-xs text-muted-foreground">
          同步于 {formatTime(environment.updatedAt)}
        </span>
      </header>
      <p className="mt-3 text-lg font-semibold">
        {environment.weather.type}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {environment.weather.temperatureLevel}
        </span>
      </p>
      <ul className="mt-4 divide-y border-t">
        {environment.places.map((place) => (
          <li key={place.id} className="py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  place.isOpen ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className={cn("flex-1", !place.isOpen && "text-muted-foreground")}>
                {place.name}
              </span>
              <span
                className={cn(
                  "text-xs",
                  place.closed ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {place.closed ? "临时关闭" : place.isOpen ? "开放" : "关闭"}
              </span>
            </div>
            {place.resources.length > 0 && (
              <p className="mt-1 pl-3.5 text-xs text-muted-foreground">
                {place.resources
                  .map((resource) => `${resource.name} ×${resource.quantity}`)
                  .join("、")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

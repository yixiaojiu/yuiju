import { items } from "../content/items";
import type { WorldState } from "../state";
import { type WorldAdvanceContext, WorldEvolution } from "./evolution";
import { localTimestamp, worldTime } from "./time";

/** 跨日后刷新目标日期的资源；离线多天的产出不累加。 */
export class ResourceEvolution extends WorldEvolution {
  precondition({ state, now, timezone }: WorldAdvanceContext): boolean {
    return nextResourceRefresh(state.resourceDate, timezone) <= now;
  }

  advance({ state, now, timezone }: WorldAdvanceContext): void {
    refreshResources(state, worldTime(now, timezone).format("YYYY-MM-DD"));
  }
}

export function nextResourceRefresh(date: string, timezone: string): number {
  const nextDate = worldTime(localTimestamp(date, 12, 0, timezone), timezone)
    .add(1, "day")
    .format("YYYY-MM-DD");
  return localTimestamp(nextDate, 0, 0, timezone);
}

/** 每日刷新为新的数量，不累加离线期间的每日产出。 */
export function refreshResources(state: WorldState, date: string): void {
  for (const placeId of ["park", "coast"] as const) {
    const pool = items.filter((item) => item.source === placeId);
    const resources = Object.fromEntries(pool.map((item) => [item.id, 0]));
    const count =
      placeId === "park" ? 1 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 4);
    for (let index = 0; index < count; index++) {
      resources[pool[Math.floor(Math.random() * pool.length)].id]++;
    }
    state.places[placeId].resources = resources;
  }
  state.resourceDate = date;
}

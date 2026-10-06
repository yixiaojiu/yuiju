import { type WorldAdvanceContext, WorldEvolution } from "./evolution";
import { worldTime } from "./time";

/** 按营业时间和临时关闭标记维护实际开放状态，供角色直接读取。 */
export class PlaceEvolution extends WorldEvolution {
  precondition({ state, now, timezone }: WorldAdvanceContext): boolean {
    return Object.entries(state.places).some(
      ([placeId, place]) => place.isOpen !== isPlaceOpen(placeId, now, timezone, place.closed),
    );
  }

  advance({ state, now, timezone }: WorldAdvanceContext): void {
    for (const [placeId, place] of Object.entries(state.places)) {
      place.isOpen = isPlaceOpen(placeId, now, timezone, place.closed);
    }
  }
}

/** 常规开放时间来自旧地点规则；未列出的地点常时开放。 */
export const openingHours: Readonly<Record<string, readonly [number, number]>> = {
  campus: [8, 17],
  shop: [9, 21],
  supermarket: [9, 21],
  diner: [7, 20],
  cafe: [10, 20],
};

export function isPlaceOpen(
  placeId: string,
  now: number,
  timezone: string,
  closed: boolean,
): boolean {
  if (closed) {
    return false;
  }
  const hours = openingHours[placeId];
  if (!hours) {
    return true;
  }
  const hour = worldTime(now, timezone).hour();
  return hour >= hours[0] && hour < hours[1];
}

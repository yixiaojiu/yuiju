import { z } from "zod";
import { changeBody } from "../state";
import { defineAction, evaluateConditions } from "./definition";

export const movement = defineAction({
  id: "移动",
  description: "沿一条已知路线前往目的地。到达前仍在途中，不会自动执行下一段路线。",
  placeIds: null,
  identities: [],
  schema: z.strictObject({ routeId: z.string().min(1) }),
  durationDescription: "按所选路线的固定耗时",
  conditions: [],
  options: ({ map, placeId, knownPlaceIds }) =>
    placeId === null
      ? []
      : map.routesByFromPlaceId
          .get(placeId)!
          .filter((route) => knownPlaceIds.has(route.toPlaceId))
          .map((route) => ({
            routeId: route.id,
            destination: route.toPlaceId,
            durationMinutes: route.durationMinutes,
            cost: route.cost,
          })),
  checkParameters(context, { routeId }) {
    const route = context.map.routesById.get(routeId);
    if (
      !route ||
      !context.knownPlaceIds.has(route.fromPlaceId) ||
      !context.knownPlaceIds.has(route.toPlaceId)
    ) {
      return [{ description: "选择一条已知路线", status: "unmet" }];
    }
    return [
      {
        description: "位于路线起点",
        status: context.character.placeId === route.fromPlaceId ? "met" : "unmet",
      },
      {
        description: `能够支付 ${route.cost.money} 金币`,
        status: context.character.money >= route.cost.money ? "met" : "unmet",
      },
      ...evaluateConditions(route.conditions, context),
    ];
  },
  start({ character, map }, { routeId }) {
    const route = map.routesById.get(routeId)!;
    character.money -= route.cost.money;
    changeBody(character, -route.cost.stamina, -route.cost.satiety);
    character.placeId = null;
    return {
      durationMinutes: route.durationMinutes,
      settlement: { routeId, fromPlaceId: route.fromPlaceId, toPlaceId: route.toPlaceId },
      description: `从${map.placesById.get(route.fromPlaceId)!.name}出发，前往${map.placesById.get(route.toPlaceId)!.name}`,
    };
  },
  complete({ character, map }, { toPlaceId }) {
    character.placeId = toPlaceId;
    return { description: `到达${map.placesById.get(toPlaceId)!.name}` };
  },
});

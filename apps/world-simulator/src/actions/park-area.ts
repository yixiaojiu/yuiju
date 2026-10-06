import { z } from "zod";
import { items } from "../content/items";
import { changeBody } from "../state";
import { durationSchema, emptyPayloadSchema } from "./anywhere";
import { daytime, minimumMoney } from "./conditions";
import { defineAction } from "./definition";
import { receiveItems } from "./inventory";

/** 公园与海岸散步都在结束时收集现场剩余资源；共享同一次世界状态提交。 */
export function createWalkAction(placeId: "park" | "coast") {
  const placeName = placeId === "park" ? "南风公园" : "月汐海岸";
  return defineAction({
    id: placeId === "park" ? "在公园散步" : "在月汐海岸散步",
    description: `在${placeName}散步，结束时可收集现场资源。`,
    placeIds: [placeId],
    identities: [],
    schema: z.strictObject({ durationMinutes: durationSchema }),
    durationDescription: "10、30、60 或 120 分钟",
    randomEvent: { probability: 0.2, positiveProbability: 0.4 },
    conditions: [],
    start(_context, { durationMinutes }) {
      return { durationMinutes, settlement: {}, description: `开始在${placeName}散步` };
    },
    complete({ state, character }, _settlement, { durationMinutes }) {
      const resources = state.places[placeId].resources;
      const collected = Object.entries(resources)
        .filter(([, quantity]) => quantity > 0)
        .map(([itemId, quantity]) => ({ itemId, quantity }));
      for (const { itemId } of collected) {
        resources[itemId] = 0;
      }
      receiveItems(character, collected);
      const description = collected.length
        ? `捡到了${collected.map((item) => `${item.itemId} ${item.quantity} 个`).join("、")}`
        : "没有捡到东西";
      return {
        description: `在${placeName}散步 ${durationMinutes} 分钟，${description}`,
      };
    },
  });
}

const pray = defineAction({
  id: "参拜",
  description: "在神社参拜。可以选择投 5 金币并说出愿望，也可以不投币。",
  placeIds: ["shrine"],
  identities: [],
  schema: z.discriminatedUnion("offering", [
    z.strictObject({ offering: z.literal(false) }),
    z.strictObject({ offering: z.literal(true), wish: z.string().min(1) }),
  ]),
  durationDescription: "10 分钟",
  conditions: [daytime],
  checkParameters: ({ character }, payload) =>
    payload.offering
      ? [{ description: "金币至少为 5", status: character.money >= 5 ? "met" : "unmet" }]
      : [],
  start({ character }, payload) {
    if (payload.offering) {
      character.money -= 5;
    }
    const description = payload.offering ? `投了 5 金币，祈愿“${payload.wish}”` : "在神社认真参拜";
    return { durationMinutes: 10, settlement: { description }, description };
  },
  complete(_context, { description }) {
    return { description: `${description}，参拜结束` };
  },
});

const fish = defineAction({
  id: "钓鱼",
  description: "在水音池钓鱼，可能获得渔获，也可能空手而归。",
  placeIds: ["pond"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "5 分钟",
  conditions: [],
  start() {
    return { durationMinutes: 5, settlement: {}, description: "在池塘边放下鱼线" };
  },
  complete({ character }) {
    let roll = Math.random() * 100;
    if (roll < 20) {
      return { description: "钓了一会儿鱼，这次没有鱼上钩" };
    }
    roll -= 20;
    for (const item of items.filter((item) => item.source === "pond")) {
      roll -= item.catchWeight;
      if (roll < 0) {
        receiveItems(character, [{ itemId: item.id, quantity: 1 }]);
        return { description: `在水音池钓到了一条${item.id}` };
      }
    }
    throw new Error("渔获概率总和必须覆盖 100%");
  },
});

const crepeMenu = [
  { name: "黄油砂糖可丽饼", price: 12 },
  { name: "香蕉巧克力可丽饼", price: 18 },
  { name: "草莓奶油可丽饼", price: 22 },
  { name: "综合水果可丽饼", price: 26 },
];
const crepeStand = defineAction({
  id: "在公园摆可丽饼摊",
  description: "花 80 金币准备本次原料，摆摊一小时，随机客流与收入，剩余原料不保留。",
  placeIds: ["park"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "60 分钟",
  randomEvent: { probability: 0.3, positiveProbability: 0.3 },
  conditions: [daytime, minimumMoney(80)],
  start({ character }) {
    character.money -= 80;
    return {
      durationMinutes: 60,
      settlement: { stockingCost: 80 },
      description: "采购原料，支起可丽饼摊",
    };
  },
  complete({ character }, { stockingCost }) {
    const visitors = Math.floor(Math.random() * 11);
    let income = 0;
    const sales: Record<string, number> = {};
    for (let index = 0; index < visitors; index++) {
      const crepe = crepeMenu[Math.floor(Math.random() * crepeMenu.length)];
      income += crepe.price;
      sales[crepe.name] = (sales[crepe.name] ?? 0) + 1;
    }
    character.money += income;
    changeBody(character, -10, -10);
    const sold = Object.entries(sales)
      .map(([name, quantity]) => `${name} ${quantity} 份`)
      .join("、");
    return {
      description: `摆摊结束，来了 ${visitors} 位顾客，${sold ? `卖出${sold}，` : ""}营业额 ${income} 金币，扣除原料费用后净收入 ${income - stockingCost} 金币`,
    };
  },
});

export const parkActions = [createWalkAction("park"), pray, fish, crepeStand];

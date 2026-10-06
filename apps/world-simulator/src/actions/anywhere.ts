import { z } from "zod";
import { itemsById } from "../content/items";
import { changeBody } from "../state";
import { defineAction } from "./definition";
import { checkInventory, consumeItems, itemSelectionSchema } from "./inventory";

export const durationSchema = z.union([
  z.literal(10),
  z.literal(30),
  z.literal(60),
  z.literal(120),
]);
export const emptyPayloadSchema = z.strictObject({});
const restRecovery = { 10: 2, 30: 5, 60: 8, 120: 12 };

export const idle = defineAction({
  id: "发呆",
  description: "原地休息，按所选时长恢复 2、5、8 或 12 点体力。",
  placeIds: null,
  identities: [],
  schema: z.strictObject({ durationMinutes: durationSchema }),
  durationDescription: "10、30、60 或 120 分钟",
  conditions: [],
  start(_context, { durationMinutes }) {
    return {
      durationMinutes,
      settlement: { stamina: restRecovery[durationMinutes] },
      description: `开始休息 ${durationMinutes} 分钟`,
    };
  },
  complete({ character }, { stamina }) {
    changeBody(character, stamina, 0);
    return { description: `休息结束，恢复了体力` };
  },
});

export const usePhone = defineAction({
  id: "玩手机",
  description: "使用手机，消耗 30% 电量。",
  placeIds: null,
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "10 分钟",
  conditions: [
    {
      description: "手机电量至少 30%",
      check: ({ character }) => (character.phoneBattery >= 30 ? "met" : "unmet"),
    },
  ],
  start({ character }) {
    character.phoneBattery -= 30;
    return { durationMinutes: 10, settlement: {}, description: "开始玩手机" };
  },
  complete() {
    return { description: "玩了一会儿手机" };
  },
});

export const eatItem = defineAction({
  id: "吃东西",
  description: "选择背包中的食物与数量，可一次吃多种食物。",
  placeIds: null,
  identities: [],
  schema: z.strictObject({ items: itemSelectionSchema }),
  durationDescription: "10 分钟",
  conditions: [],
  options: ({ character }) =>
    Object.entries(character.inventory)
      .filter(([id, quantity]) => quantity > 0 && itemsById.get(id)!.categories.includes("food"))
      .map(([id, quantity]) => ({
        itemId: id,
        quantity,
        description: itemsById.get(id)!.description,
      })),
  checkParameters: ({ character }, { items }) => checkInventory(character, items, "food"),
  start({ character }, { items }) {
    const stamina = items.reduce(
      (sum, item) => sum + itemsById.get(item.itemId)!.stamina * item.quantity,
      0,
    );
    const satiety = items.reduce(
      (sum, item) => sum + itemsById.get(item.itemId)!.satiety * item.quantity,
      0,
    );
    consumeItems(character, items);
    return {
      durationMinutes: 10,
      settlement: {
        stamina,
        satiety,
        description: items.map((item) => `${item.itemId} ${item.quantity} 份`).join("、"),
      },
      description: "开始吃东西",
    };
  },
  complete({ character }, { description, stamina, satiety }) {
    changeBody(character, stamina, satiety);
    return { description: `吃完了${description}` };
  },
});

export const anywhereActions = [idle, usePhone, eatItem];

import type { ConditionView } from "@yuiju/shared/world/protocol";
import { z } from "zod";
import { items, itemsById } from "../content/items";
import { worldTime } from "../environment/time";
import { changeBody } from "../state";
import { emptyPayloadSchema } from "./anywhere";
import { defineAction } from "./definition";
import { checkInventory, consumeItems, itemSelectionSchema, receiveItems } from "./inventory";

/** 两处购买均为开始付款、到期入包；商店每次一种，超市可以多种。 */
function createPurchaseAction(source: "shop" | "supermarket") {
  const catalog = items.filter((item) => item.source === source);
  return defineAction({
    id: source === "shop" ? "在商店购买物品" : "在超市购买食材",
    description:
      source === "shop"
        ? "选择一种商品及数量购买，付款后等待取货。"
        : "选择多种食材及数量购买，付款后等待结账装袋。",
    placeIds: [source],
    identities: [],
    schema: z.strictObject({
      items:
        source === "shop"
          ? itemSelectionSchema.refine(
              (selection) => selection.length === 1,
              "商店每次购买一种商品",
            )
          : itemSelectionSchema,
    }),
    durationDescription: source === "shop" ? "10 分钟" : "5 分钟",
    conditions: [],
    options: () =>
      catalog.map((item) => ({
        itemId: item.id,
        price: item.price,
        description: item.description,
      })),
    checkParameters({ character }, { items: selection }) {
      const conditions: ConditionView[] = [];
      let price = 0;
      for (const { itemId, quantity } of selection) {
        const item = catalog.find((candidate) => candidate.id === itemId);
        conditions.push({
          description: `${itemId}是本店出售的商品`,
          status: item ? "met" : "unmet",
        });
        if (item) {
          price += item.price! * quantity;
        }
      }
      conditions.push({
        description: `金币足够支付 ${price}`,
        status: character.money >= price ? "met" : "unmet",
      });
      return conditions;
    },
    start({ character }, { items: selection }) {
      const total = selection.reduce(
        (sum, choice) => sum + itemsById.get(choice.itemId)!.price! * choice.quantity,
        0,
      );
      character.money -= total;
      return {
        durationMinutes: source === "shop" ? 10 : 5,
        settlement: { items: selection, total },
        description: `支付了 ${total} 金币，等待取货`,
      };
    },
    complete({ character }, { items: selection, total }) {
      receiveItems(character, selection);
      return {
        description: `花费 ${total} 金币，买到了${selection.map((item) => `${item.itemId} ${item.quantity} 份`).join("、")}`,
      };
    },
  });
}

/** 店内消费不会经过背包；费用和营养在开始时形成结算快照。 */
function createDiningAction(source: "cafe" | "diner") {
  const catalog = items.filter((item) => item.source === source);
  return defineAction({
    id: source === "cafe" ? "喝咖啡" : "在日和食堂就餐",
    description: source === "cafe" ? "选择一杯咖啡，在店里慢慢喝。" : "选择一份餐品，在食堂吃饭。",
    placeIds: [source],
    identities: [],
    schema: z.strictObject({ itemId: z.string().min(1) }),
    durationDescription: source === "cafe" ? "30 分钟" : "20 分钟",
    conditions: [],
    options: () =>
      catalog.map((item) => ({
        itemId: item.id,
        price: item.price,
        description: item.description,
        stamina: item.stamina,
        satiety: item.satiety,
      })),
    checkParameters({ character }, { itemId }) {
      const item = catalog.find((candidate) => candidate.id === itemId);
      if (!item) {
        return [{ description: "选择本店菜单上的餐品", status: "unmet" }];
      }
      return [
        {
          description: `金币足够支付 ${item.price}`,
          status: character.money >= item.price! ? "met" : "unmet",
        },
      ];
    },
    start({ character }, { itemId }) {
      const item = itemsById.get(itemId)!;
      character.money -= item.price!;
      return {
        durationMinutes: source === "cafe" ? 30 : 20,
        settlement: { itemId, stamina: item.stamina, satiety: item.satiety },
        description: `点了${itemId}，支付 ${item.price} 金币`,
      };
    },
    complete({ character }, { itemId, stamina, satiety }) {
      changeBody(character, stamina, satiety);
      return { description: `在店里享用完${itemId}` };
    },
  });
}

const sell = defineAction({
  id: "在超市售卖物品",
  description: "选择背包中有售卖价格的物品及数量，一次可卖多种。",
  placeIds: ["supermarket"],
  identities: [],
  schema: z.strictObject({ items: itemSelectionSchema }),
  durationDescription: "5 分钟",
  conditions: [],
  options: ({ character }) =>
    Object.entries(character.inventory)
      .filter(([id]) => itemsById.get(id)!.salePrice !== null)
      .map(([id, quantity]) => ({ itemId: id, quantity, salePrice: itemsById.get(id)!.salePrice })),
  checkParameters({ character }, { items: selection }) {
    return [
      ...checkInventory(character, selection),
      ...selection.map(
        ({ itemId }): ConditionView => ({
          description: `${itemId}可以出售`,
          status:
            itemsById.has(itemId) && itemsById.get(itemId)!.salePrice !== null ? "met" : "unmet",
        }),
      ),
    ];
  },
  start({ character }, { items: selection }) {
    const income = selection.reduce(
      (sum, item) => sum + itemsById.get(item.itemId)!.salePrice! * item.quantity,
      0,
    );
    consumeItems(character, selection);
    character.money += income;
    return {
      durationMinutes: 5,
      settlement: { income, items: selection },
      description: `售出物品获得 ${income} 金币，等待结算手续完成`,
    };
  },
  complete(_context, { income, items: selection }) {
    return {
      description: `售卖${selection.map((item) => `${item.itemId} ${item.quantity} 份`).join("、")}完成，共获得 ${income} 金币`,
    };
  },
});

const work = defineAction({
  id: "打工",
  description: "在薄暮咖啡打工一小时，收入 200 金币，消耗 10 点体力和饱腹。",
  placeIds: ["cafe"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "60 分钟",
  randomEvent: { probability: 0.3, positiveProbability: 0.3 },
  conditions: [
    {
      description: "开始时间在 10:00 至 16:00 之间",
      check: ({ now, timezone }) => {
        const time = worldTime(now, timezone);
        const minutes = time.hour() * 60 + time.minute();
        return minutes >= 600 && minutes <= 960 ? "met" : "unmet";
      },
    },
  ],
  start() {
    return { durationMinutes: 60, settlement: { income: 200 }, description: "开始在咖啡店打工" };
  },
  complete({ character }, { income }) {
    character.money += income;
    changeBody(character, -10, -10);
    return {
      description: `在咖啡店打工一小时，赚了 ${income} 金币`,
    };
  },
});

export const businessActions = [
  createPurchaseAction("shop"),
  createPurchaseAction("supermarket"),
  createDiningAction("cafe"),
  createDiningAction("diner"),
  sell,
  work,
];

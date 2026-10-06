import { z } from "zod";
import { itemsById } from "../content/items";
import { localTimestamp, worldTime } from "../environment/time";
import { changeBody } from "../state";
import { emptyPayloadSchema } from "./anywhere";
import { defineAction } from "./definition";
import { checkInventory, consumeItems } from "./inventory";

const wakeUp = defineAction({
  id: "起床",
  description: "起床洗漱，开始一天的生活。体力设为 85，饱腹设为 20。",
  placeIds: ["home_interior"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "10 分钟",
  conditions: [],
  start({ character }) {
    character.stamina = 85;
    character.satiety = 20;
    return { durationMinutes: 10, settlement: {}, description: "起床洗漱" };
  },
  complete() {
    return { description: "洗漱完毕" };
  },
});
const nap = defineAction({
  id: "再睡一会",
  description: "在家再睡一小会儿。",
  placeIds: ["home_interior"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "10 分钟",
  conditions: [],
  start() {
    return { durationMinutes: 10, settlement: {}, description: "再睡一会儿" };
  },
  complete() {
    return { description: "闹钟响了，稍微多睡了一会儿，醒来了" };
  },
});
const chargePhone = defineAction({
  id: "给手机充电",
  description: "将手机充满，每补充 10% 电量需要 3 分钟。",
  placeIds: ["home_interior"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "按开始时缺少的电量计算，每 10% 耗时 3 分钟",
  conditions: [
    {
      description: "手机尚未充满",
      check: ({ character }) => (character.phoneBattery < 100 ? "met" : "unmet"),
    },
  ],
  start({ character }) {
    return {
      durationMinutes: (100 - character.phoneBattery) * 0.3,
      settlement: {},
      description: "开始给手机充电",
    };
  },
  complete({ character }) {
    character.phoneBattery = 100;
    return { description: "手机充好了电，电量 100%" };
  },
});
const sleep = defineAction({
  id: "睡觉",
  description: "睡到下一次早晨 07:30，醒来时体力为 85、饱腹为 20。",
  placeIds: ["home_interior"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "到下一次早晨 07:30",
  conditions: [
    {
      description: "夜间 22:00 至次日 06:00",
      check: ({ now, timezone }) => {
        const hour = worldTime(now, timezone).hour();
        return hour >= 22 || hour < 6 ? "met" : "unmet";
      },
    },
  ],
  start({ now, timezone }) {
    const time = worldTime(now, timezone);
    const date = (time.hour() >= 22 ? time.add(1, "day") : time).format("YYYY-MM-DD");
    return {
      durationMinutes: (localTimestamp(date, 7, 30, timezone) - now) / 60_000,
      settlement: {},
      description: "入睡了",
    };
  },
  complete({ character }) {
    character.stamina = 85;
    character.satiety = 20;
    return { description: "闹钟响了，睡醒了" };
  },
});
const cook = defineAction({
  id: "在家做饭吃",
  description: "从背包选择至少一种不同食材，每种使用一份，做成一餐吃掉。",
  placeIds: ["home_interior"],
  identities: [],
  schema: z.strictObject({
    ingredientIds: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "食材不能重复"),
  }),
  durationDescription: "30 分钟",
  conditions: [],
  options: ({ character }) =>
    Object.entries(character.inventory)
      .filter(([id]) => itemsById.get(id)!.categories.includes("ingredient"))
      .map(([id, quantity]) => ({
        itemId: id,
        quantity,
        description: itemsById.get(id)!.description,
      })),
  checkParameters: ({ character }, { ingredientIds }) =>
    checkInventory(
      character,
      ingredientIds.map((itemId) => ({ itemId, quantity: 1 })),
      "ingredient",
    ),
  start({ character }, { ingredientIds }) {
    const ingredients = ingredientIds.map((id) => itemsById.get(id)!);
    const stamina = Math.max(
      1,
      Math.round(ingredients.reduce((sum, item) => sum + item.stamina, 0) * 1.1),
    );
    const satiety = Math.max(
      1,
      Math.round(ingredients.reduce((sum, item) => sum + item.satiety, 0) * 1.2),
    );
    consumeItems(
      character,
      ingredientIds.map((itemId) => ({ itemId, quantity: 1 })),
    );
    return {
      durationMinutes: 30,
      settlement: { stamina, satiety, ingredients: ingredientIds.join("、") },
      description: `准备好${ingredientIds.join("、")}，开始做饭`,
    };
  },
  complete({ character }, { stamina, satiety, ingredients }) {
    changeBody(character, stamina, satiety);
    return { description: `用${ingredients}做好了一餐并吃完` };
  },
});

const stayHome = defineAction({
  id: "待在家里",
  description: "周末待在家中放松或学习，开始时恢复 20 点体力、消耗 10 点饱腹。",
  placeIds: ["home_interior"],
  identities: [],
  schema: emptyPayloadSchema,
  durationDescription: "60 分钟",
  conditions: [
    {
      description: "周末",
      // 旧实现工作日同时检查下午和晚上，实际只有周末可用；未确认修改前保留真实规则。
      check: ({ now, timezone }) =>
        [0, 6].includes(worldTime(now, timezone).day()) ? "met" : "unmet",
    },
  ],
  start({ character }) {
    changeBody(character, 20, -10);
    return { durationMinutes: 60, settlement: {}, description: "待在家里放松或学习" };
  },
  complete() {
    return { description: "在家度过了一段悠闲的时间" };
  },
});

export const homeActions = [wakeUp, nap, chargePhone, sleep, cook, stayHome];

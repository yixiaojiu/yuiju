import {
  ActionId,
  type ActionMetadata,
  allTrue,
  CAFE_COFFEES,
  type CafeCoffee,
  type CafeCoffeeName,
  type ChoiceOption,
  MajorScene,
  planManager,
} from "@yuiju/utils";
import { chooseCafeCoffeeAgent } from "@/llm/agent";
import { logger } from "@/utils/logger";
import { buildFoodMetadata } from "../utils/food-utils";

const CAFE_MIN_PRICE = Math.min(...CAFE_COFFEES.map((p) => p.price));

function isAtCafe(major: MajorScene) {
  return major === MajorScene.Cafe;
}

function formatCoffeeDescription(coffee: CafeCoffee) {
  const description: string[] = [];
  if (coffee.stamina) {
    description.push(`[体力+${coffee.stamina}]`);
  }
  if (coffee.satiety) {
    description.push(`[饱腹+${coffee.satiety}]`);
  }
  if (coffee.mood) {
    description.push(`[心情+${coffee.mood}]`);
  }

  return `${coffee.description}${description.join("")}`;
}

function isCafeWorkTimeWithAtLeastOneHourLeft(time: { hour: () => number; minute: () => number }) {
  const minutesSinceMidnight = time.hour() * 60 + time.minute();
  return minutesSinceMidnight >= 10 * 60 && minutesSinceMidnight <= 16 * 60;
}

/**
 * 判断字符串是否为薄暮咖啡馆的合法咖啡名。
 *
 * 说明：
 * - 背包 item.name 的类型是 string（来源可能很多），这里通过清单做一次收窄；
 * - 这样后续 find/消费逻辑可以使用 CafeCoffeeName 的强类型。
 */
function isCafeCoffeeName(name: string): name is CafeCoffeeName {
  return CAFE_COFFEES.some((coffee) => coffee.name === name);
}

/**
 * 从背包中找出“可以喝的咖啡名”列表（强类型）。
 */
function getAvailableCafeCoffeeNames(context: {
  characterState: { inventory?: Array<{ name: string; category: string; quantity: number }> };
}): CafeCoffeeName[] {
  const inventory = context.characterState.inventory || [];
  return inventory
    .filter((item) => item.category === "food" && item.quantity > 0)
    .map((item) => item.name)
    .filter(isCafeCoffeeName);
}

export const cafeAction: ActionMetadata[] = [
  {
    action: ActionId.Order_Coffee,
    description: "在薄暮咖啡馆点单。[金币-?][耗时10分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([
        () => isAtCafe(context.characterState.location.major),
        () => context.characterState.money >= CAFE_MIN_PRICE,
      ]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Order_Coffee);

      const coffeeList: ChoiceOption[] = CAFE_COFFEES.map((coffee) => {
        return {
          value: coffee.name,
          description: formatCoffeeDescription(coffee),
          extra: { price: coffee.price },
        };
      });

      const selectedCoffee = await chooseCafeCoffeeAgent(
        coffeeList,
        context,
        [],
        await planManager.getState(),
      );
      if (!selectedCoffee) {
        logger.error("[Order_Coffee] 没有选择咖啡");
        return { executionResult: "点单失败，没有选择咖啡。" };
      }

      const coffee = CAFE_COFFEES.find((p) => p.name === selectedCoffee.value);
      if (!coffee) {
        logger.error(`[Order_Coffee] 未找到咖啡: ${selectedCoffee.value}`);
        return { executionResult: "点单失败，未找到咖啡。" };
      }

      const cost = coffee.price;
      if (context.characterState.money < cost) {
        logger.info(
          `[Order_Coffee] 余额不足，跳过点单: ${coffee.name}（单价${coffee.price}元，余额${context.characterState.money}元）`,
        );
        return { executionResult: "点单失败，余额不足。" };
      }

      await context.characterState.changeMoney(-cost);

      logger.info(`[Order_Coffee] 点单成功: ${coffee.name}，花费${cost}元`);

      return {
        executionResult: `点了${coffee.name}，花费${cost}元`,
        startContext: {
          coffeeName: coffee.name,
          description: coffee.description,
          stamina: coffee.stamina,
          satiety: coffee.satiety,
          mood: coffee.mood,
        },
      };
    },
    durationMin: 10,
    async completionEvent(context, runningAction) {
      const coffeeContext = runningAction.startContext as {
        coffeeName: CafeCoffeeName;
        description: string;
        stamina?: number;
        satiety?: number;
        mood?: number;
      };

      await context.characterState.addItem(
        {
          name: coffeeContext.coffeeName,
          description: coffeeContext.description,
          category: "food",
          metadata: buildFoodMetadata({
            stamina: coffeeContext.stamina,
            satiety: coffeeContext.satiety,
            mood: coffeeContext.mood,
            fallbackSatiety: 2,
          }),
        },
        1,
      );

      return {
        completionContext: {
          producedItem: {
            name: coffeeContext.coffeeName,
            quantity: 1,
          },
        },
        eventDescription: `${coffeeContext.coffeeName}制作完成`,
      };
    },
  },
  {
    action: ActionId.Drink_Coffee,
    description: "喝咖啡。[体力+?][饱腹+?][心情+?][耗时30分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(_context) {
      return false;
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Drink_Coffee);

      const availableCoffeeNames = getAvailableCafeCoffeeNames(context);
      const coffeeName = availableCoffeeNames[0];
      if (!coffeeName) {
        return { executionResult: "没有咖啡可以喝。" };
      }

      const consumed = await context.characterState.consumeItem(coffeeName, 1);
      if (!consumed) {
        return { executionResult: `喝咖啡失败，没有喝到${coffeeName}。` };
      }

      const coffee = CAFE_COFFEES.find((item) => item.name === coffeeName);

      return {
        executionResult: `开始喝${coffeeName}`,
        startContext: {
          coffeeName,
          stamina: coffee?.stamina ?? 0,
          satiety: coffee?.satiety ?? 0,
          mood: coffee?.mood ?? 0,
        },
      };
    },
    async completionEvent(context, runningAction) {
      const drinkContext = runningAction.startContext as {
        coffeeName: CafeCoffeeName;
        stamina: number;
        satiety: number;
        mood: number;
      };

      const result: string[] = [];
      if (drinkContext.stamina !== 0) {
        await context.characterState.changeStamina(drinkContext.stamina);
        result.push(`[体力+${drinkContext.stamina}]`);
      }
      if (drinkContext.satiety !== 0) {
        await context.characterState.changeSatiety(drinkContext.satiety);
        result.push(`[饱腹+${drinkContext.satiety}]`);
      }
      if (drinkContext.mood !== 0) {
        await context.characterState.changeMood(drinkContext.mood);
        result.push(`[心情+${drinkContext.mood}]`);
      }

      return {
        completionContext: drinkContext,
        eventDescription: `喝完了${drinkContext.coffeeName}${result.join(",")}`,
      };
    },
    durationMin: 30,
  },
  {
    action: ActionId.Work_At_Cafe,
    description: "在薄暮咖啡馆打工。[金币+200][体力-10][心情-5][饱腹-10][耗时60分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([
        () => isAtCafe(context.characterState.location.major),
        () => isCafeWorkTimeWithAtLeastOneHourLeft(context.worldState.time),
      ]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Work_At_Cafe);
    },
    async completionEvent(context) {
      await context.characterState.changeMoney(200);
      await context.characterState.changeStamina(-10);
      await context.characterState.changeSatiety(-10);
      await context.characterState.changeMood(-5);
      return {
        completionContext: {
          earnedMoney: 200,
          staminaDelta: -10,
          satietyDelta: -10,
          moodDelta: -5,
        },
        eventDescription: "在薄暮咖啡馆打工1小时，赚了200元",
      };
    },
    durationMin: 60,
  },
  {
    action: ActionId.Go_Home_From_Cafe,
    description: "从薄暮咖啡馆回家。[体力-5][饱腹-3][耗时20分钟]",
    precondition(context) {
      return isAtCafe(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_Home_From_Cafe);
      await context.characterState.setLocation({ major: MajorScene.Home });
      await context.characterState.changeStamina(-5);
      await context.characterState.changeSatiety(-3);
    },
    durationMin: 20,
  },
  {
    action: ActionId.Go_To_School_From_Cafe,
    description: "从薄暮咖啡馆去星见丘高校。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return isAtCafe(context.characterState.location.major);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_School_From_Cafe);
      await context.characterState.setLocation({ major: MajorScene.School });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
];

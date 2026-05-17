import {
  type ActionContext,
  ActionId,
  type ActionMetadata,
  allTrue,
  type ChoiceOption,
  type FoodMetadata,
  isDev,
  MajorScene,
  planManager,
} from "@yuiju/utils";
import { chooseFoodAgent } from "@/llm/agent";
import { generateDiaryForDate, resolveDiaryDateForSleep } from "@/memory/diary";
import { logger } from "@/utils/logger";
import { resolveFoodRecoveryPerUnit } from "../utils/food-utils";
import {
  isAfternoon,
  isEvening,
  isMorning,
  isNight,
  isWeekday,
  isWeekend,
  notDoneToday,
} from "./utils";

type CookingIngredientSnapshot = {
  name: string;
  quantity: number;
  metadata?: FoodMetadata;
};

type CookingStartContext = {
  ingredients: CookingIngredientSnapshot[];
};

function getAvailableCookingIngredientOptions(context: ActionContext): ChoiceOption[] {
  const inventory = context.characterState.inventory || [];
  return inventory
    .filter((item) => item.category === "food" && item.quantity > 0)
    .map((item): ChoiceOption => {
      return {
        value: item.name,
        description: `${item.description}（剩余${item.quantity}个）`,
        extra: {
          metadata: item.metadata,
          availableQuantity: item.quantity,
        },
      };
    });
}

function readCookingStartContext(
  startContext: Record<string, unknown> | undefined,
): CookingStartContext | null {
  const ingredients = startContext?.ingredients;
  if (!Array.isArray(ingredients)) {
    return null;
  }

  const parsedIngredients = ingredients
    .map((ingredient): CookingIngredientSnapshot | null => {
      if (!ingredient || typeof ingredient !== "object") {
        return null;
      }

      const maybeIngredient = ingredient as Partial<CookingIngredientSnapshot>;
      if (typeof maybeIngredient.name !== "string") {
        return null;
      }

      if (
        typeof maybeIngredient.quantity !== "number" ||
        !Number.isFinite(maybeIngredient.quantity) ||
        maybeIngredient.quantity <= 0
      ) {
        return null;
      }

      return {
        name: maybeIngredient.name,
        quantity: maybeIngredient.quantity,
        metadata:
          maybeIngredient.metadata &&
          typeof maybeIngredient.metadata === "object" &&
          !Array.isArray(maybeIngredient.metadata)
            ? (maybeIngredient.metadata as FoodMetadata)
            : undefined,
      };
    })
    .filter((ingredient): ingredient is CookingIngredientSnapshot => Boolean(ingredient));

  return parsedIngredients.length > 0 ? { ingredients: parsedIngredients } : null;
}

export const homeAction: ActionMetadata[] = [
  {
    action: ActionId.Wake_Up,
    description: "起床并洗漱，新的一天开始。[体力=85][饱腹=20][耗时10分钟]",
    // 已在 precheckAction 中处理
    precondition() {
      return false;
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Wake_Up);
      await context.characterState.setStamina(85);
      await context.characterState.setSatiety(20);
      await context.characterState.clearDailyActions();
    },
    durationMin: 10,
  },
  {
    action: ActionId.Sleep_For_A_Little,
    description: "再睡一会。[心情+1][耗时10分钟]",
    precondition() {
      // 已在 precheckAction 中处理
      return false;
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Sleep_For_A_Little);
    },
    async completionEvent(context) {
      await context.characterState.changeMood(1);
      return { eventDescription: "闹钟响了，稍微多睡了一会儿" };
    },
    durationMin: 10,
  },
  {
    action: ActionId.Eat_Breakfast,
    description: "吃早餐[饱腹+40][体力+10][耗时20分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([isMorning(context), () => notDoneToday(context, ActionId.Eat_Breakfast)]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Eat_Breakfast);
    },
    async completionEvent(context) {
      await context.characterState.changeSatiety(40);
      await context.characterState.changeStamina(10);
      await context.characterState.markActionDoneToday(ActionId.Eat_Breakfast);
      return { eventDescription: "吃完早餐，体力和饱腹恢复了" };
    },
    durationMin: 20,
  },
  {
    action: ActionId.Go_To_School_From_Home,
    description: "前往星见丘高校。[体力-7][饱腹-5][耗时30分钟]",
    precondition(context) {
      return allTrue([isWeekday(context), isMorning(context)]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_School_From_Home);
      await context.characterState.setLocation({
        major: MajorScene.School,
      });
      await context.characterState.changeStamina(-7);
      await context.characterState.changeSatiety(-5);
    },
    durationMin: 30,
  },
  {
    action: ActionId.Go_To_Shop_From_Home,
    description: "从家前往小町商店。[体力-5][饱腹-3][耗时20分钟]",
    precondition(context) {
      return context.characterState.stamina >= 5 && !isNight(context);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Shop_From_Home);
      await context.characterState.setLocation({
        major: MajorScene.Shop,
      });
      await context.characterState.changeStamina(-5);
      await context.characterState.changeSatiety(-3);
    },
    durationMin: 20,
  },
  {
    action: ActionId.Go_To_Cafe_From_Home,
    description: "从家去薄暮咖啡馆。[体力-5][饱腹-3][耗时20分钟]",
    precondition(context) {
      return allTrue([context.characterState.stamina >= 5, !isNight(context)]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Cafe_From_Home);
      await context.characterState.setLocation({
        major: MajorScene.Cafe,
      });
      await context.characterState.changeStamina(-5);
      await context.characterState.changeSatiety(-3);
    },
    durationMin: 20,
  },
  {
    action: ActionId.Go_To_Park_From_Home,
    description: "从家前往南风公园。[体力-3][饱腹-2][耗时10分钟]",
    precondition(context) {
      return context.characterState.stamina >= 3 && !isNight(context);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Go_To_Park_From_Home);
      await context.characterState.setLocation({
        major: MajorScene.Park,
      });
      await context.characterState.changeStamina(-3);
      await context.characterState.changeSatiety(-2);
    },
    durationMin: 10,
  },
  {
    action: ActionId.Eat_Dinner,
    description: "吃晚餐。[饱腹+40][体力+10][耗时20分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      return allTrue([isEvening(context), () => notDoneToday(context, ActionId.Eat_Dinner)]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Eat_Dinner);
    },
    async completionEvent(context) {
      await context.characterState.changeSatiety(40);
      await context.characterState.changeStamina(10);
      await context.characterState.markActionDoneToday(ActionId.Eat_Dinner);
      return { eventDescription: "吃完晚餐，体力和饱腹恢复了" };
    },
    durationMin: 20,
  },
  {
    action: ActionId.Cook_At_Home,
    description: "在家做饭，从背包中选择食材，完成后获得料理。[耗时30分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      // TODO：这个 Action 先关闭
      return false;

      // const hour = context.worldState.time.get("hour");
      // const minute = context.worldState.time.get("minute");
      // const minutesOfDay = hour * 60 + minute;
      // return allTrue([
      //   () => context.characterState.location.major === MajorScene.Home,
      //   () =>
      //     (minutesOfDay >= 6 * 60 + 30 && minutesOfDay < 8 * 60 + 30) ||
      //     (minutesOfDay >= 11 * 60 && minutesOfDay < 13 * 60) ||
      //     (minutesOfDay >= 17 * 60 && minutesOfDay < 19 * 60),
      //   () => getAvailableCookingIngredientOptions(context).length > 0,
      // ]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Cook_At_Home);

      const ingredientOptions = getAvailableCookingIngredientOptions(context);
      if (ingredientOptions.length === 0) {
        return { executionResult: "没有可以用来做饭的食材。" };
      }

      // TODO：这里应该是一个单独选择做饭食材的 Agent
      const selectedIngredients = await chooseFoodAgent(
        ingredientOptions,
        context,
        [],
        await planManager.getState(),
      );

      if (!selectedIngredients?.length) {
        return { executionResult: "没有选择做饭食材。" };
      }

      const ingredients: CookingIngredientSnapshot[] = [];

      for (const selectedIngredient of selectedIngredients) {
        const ingredientOption = ingredientOptions.find(
          (option) => option.value === selectedIngredient.value,
        );
        if (!ingredientOption) {
          continue;
        }

        const availableQuantity =
          typeof ingredientOption.extra?.availableQuantity === "number"
            ? ingredientOption.extra.availableQuantity
            : 1;
        const quantity = Math.min(Math.max(1, selectedIngredient.quantity || 1), availableQuantity);
        const consumed = await context.characterState.consumeItem(
          selectedIngredient.value,
          quantity,
        );
        if (!consumed) {
          logger.error(`[Cook_At_Home] 消费食材失败: ${selectedIngredient.value} x${quantity}`);
          continue;
        }

        ingredients.push({
          name: selectedIngredient.value,
          quantity,
          metadata:
            ingredientOption.extra?.metadata &&
            typeof ingredientOption.extra.metadata === "object" &&
            !Array.isArray(ingredientOption.extra.metadata)
              ? (ingredientOption.extra.metadata as FoodMetadata)
              : undefined,
        });
      }

      if (ingredients.length === 0) {
        return { executionResult: "做饭失败，没有成功准备食材。" };
      }

      return {
        startContext: {
          ingredients,
        },
      };
    },
    durationMin: 30,
    async completionEvent(context, runningAction) {
      const cookingContext = readCookingStartContext(runningAction.startContext);
      if (!cookingContext) {
        return { eventDescription: "料理没有做成功。" };
      }

      const ingredientNames = cookingContext.ingredients.map((ingredient) => ingredient.name);
      const producedName =
        cookingContext.ingredients.length === 1 ? `${ingredientNames[0]}料理` : "家常料理";

      let stamina = 0;
      let satiety = 0;
      let mood = 0;

      for (const ingredient of cookingContext.ingredients) {
        const recovery = resolveFoodRecoveryPerUnit(ingredient.metadata);
        stamina += recovery.stamina * ingredient.quantity;
        satiety += recovery.satiety * ingredient.quantity;
        mood += recovery.mood * ingredient.quantity;
      }

      const metadata: FoodMetadata = {};
      if (stamina !== 0) {
        metadata.stamina = stamina;
      }
      if (satiety !== 0) {
        metadata.satiety = satiety;
      }
      if (mood !== 0) {
        metadata.mood = mood;
      }

      await context.characterState.addItem(
        {
          name: producedName,
          description: `用${ingredientNames.join("、")}做出的料理。`,
          category: "food",
          metadata,
        },
        1,
      );

      return {
        completionContext: {
          producedItem: {
            name: producedName,
            quantity: 1,
            metadata,
          },
          ingredients: cookingContext.ingredients,
        },
        eventDescription: `用${ingredientNames.join("、")}做出了一份${producedName}`,
      };
    },
  },
  {
    action: ActionId.Stay_At_Home,
    description: "待在家中，放松、学习。[体力+20][饱腹-10][心情+5][耗时60分钟]",
    proactiveShare: {
      enabled: true,
    },
    precondition(context) {
      if (isWeekend(context)) {
        return true;
      } else {
        return allTrue([isAfternoon(context), isEvening(context)]);
      }
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Stay_At_Home);
      await context.characterState.changeStamina(20);
      await context.characterState.changeSatiety(-10);
      await context.characterState.changeMood(5);
    },
    durationMin: 60,
  },
  {
    action: ActionId.Sleep,
    description: "睡觉。[耗时动态]",
    precondition(context) {
      return allTrue([isNight(context)]);
    },
    async executor(context) {
      await context.characterState.setAction(ActionId.Sleep);
      await context.characterState.clearDailyActions();

      // 进入正式睡眠后，后台异步生成“当天日记”，不阻塞行为主链路。
      generateDiaryForDate({
        diaryDate: resolveDiaryDateForSleep(context.worldState.time.toDate()),
        isDev: isDev(),
      }).catch((error) => {
        logger.error("[homeAction.Sleep] generate diary failed", error);
      });
    },
    durationMin: async (context) => {
      const now = context.worldState.time.clone();
      let target = now.hour(7).minute(30).second(0).millisecond(0);

      if (target.isBefore(now)) {
        target = target.add(1, "day");
      }

      return target.diff(now, "minute");
    },
    async completionEvent(context) {
      await context.characterState.setStamina(85);
      await context.characterState.setSatiety(20);
      await context.characterState.changeMood(2);
      return { eventDescription: "闹钟响了，睡醒了" };
    },
  },
];

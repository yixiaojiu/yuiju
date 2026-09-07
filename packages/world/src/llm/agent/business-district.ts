import type { ActionContext, BehaviorRecord, ChoiceOption, PlanState } from "@yuiju/utils";
import {
  chooseCafeCoffeePrompt,
  chooseDinerMealPrompt,
  chooseSellableItemPrompt,
  chooseShopProductPrompt,
  chooseSupermarketProductPrompt,
  generateStructuredOutput,
} from "@yuiju/utils";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { type ParameterAgentSelectedItem, RETRY_COUNT } from "./shared";

/**
 *
 * 选择购买商品
 */
export async function chooseShopProductAgent(
  productList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem | undefined> {
  if (productList.length === 0) {
    return;
  }

  const systemPrompt = chooseShopProductPrompt({
    actionReason,
    availableProducts: productList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    planState,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        reasoning: "none",
        output: Output.object({
          schema: z.object({
            value: z.enum(productList.map((item) => item.value)).describe("选择的商品名称"),
            quantity: z.number().describe("购买数量"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseShopProductAgent] 选择商品结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseShopProductAgent] 选择商品失败", error);
    }
  }
}

/**
 *
 * 选择咖啡
 */
export async function chooseCafeCoffeeAgent(
  coffeeList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem | undefined> {
  if (coffeeList.length === 0) {
    return;
  }

  const systemPrompt = chooseCafeCoffeePrompt({
    actionReason,
    availableCoffees: coffeeList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    planState,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        reasoning: "none",
        output: Output.object({
          schema: z.object({
            value: z.enum(coffeeList.map((item) => item.value)).describe("选择的咖啡名称"),
            quantity: z.number().describe("点单数量"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseCafeCoffeeAgent] 选择咖啡结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseCafeCoffeeAgent] 选择咖啡失败", error);
    }
  }
}

/**
 *
 * 选择超市食材
 */
export async function chooseSupermarketProductAgent(
  productList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem[] | undefined> {
  if (productList.length === 0) {
    return;
  }

  const systemPrompt = chooseSupermarketProductPrompt({
    actionReason,
    availableProducts: productList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    planState,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        reasoning: "none",
        output: Output.object({
          schema: z.object({
            selectedList: z
              .array(
                z.object({
                  value: z.enum(productList.map((item) => item.value)).describe("选择的食材名称"),
                  quantity: z.number().describe("购买数量"),
                }),
              )
              .describe("本次选择购买的食材列表"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseSupermarketProductAgent] 选择食材结果", output);
      return output.selectedList;
    } catch (error) {
      logger.error("[chooseSupermarketProductAgent] 选择食材失败", error);
    }
  }
}

/**
 *
 * 选择售卖物品
 */
export async function chooseSellableItemAgent(
  itemList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem[] | undefined> {
  if (itemList.length === 0) {
    return;
  }

  const systemPrompt = chooseSellableItemPrompt({
    actionReason,
    availableItems: itemList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    planState,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        reasoning: "none",
        output: Output.object({
          schema: z.object({
            selectedList: z
              .array(
                z.object({
                  value: z.enum(itemList.map((item) => item.value)).describe("选择的物品名称"),
                  quantity: z.number().describe("售卖数量"),
                }),
              )
              .describe("本次选择售卖的物品列表"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseSellableItemAgent] 选择售卖物品结果", output);
      return output.selectedList;
    } catch (error) {
      logger.error("[chooseSellableItemAgent] 选择售卖物品失败", error);
    }
  }
}

/**
 *
 * 选择日和食堂餐品
 */
export async function chooseDinerMealAgent(
  mealList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem | undefined> {
  if (mealList.length === 0) {
    return;
  }

  const systemPrompt = chooseDinerMealPrompt({
    actionReason,
    availableMeals: mealList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    planState,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getFlashModel(),
        reasoning: "none",
        output: Output.object({
          schema: z.object({
            value: z.enum(mealList.map((item) => item.value)).describe("选择的餐品名称"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseDinerMealAgent] 选择餐品结果", output);
      return {
        value: output.value,
        quantity: 1,
      };
    } catch (error) {
      logger.error("[chooseDinerMealAgent] 选择餐品失败", error);
    }
  }
}

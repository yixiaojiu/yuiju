import type { ActionContext, BehaviorRecord, ChoiceOption, PlanState } from "@yuiju/utils";
import { generateStructuredOutput, planHomeCookingPrompt } from "@yuiju/utils";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { RETRY_COUNT } from "./shared";

export interface HomeCookingPlan {
  ingredients: string[];
  cookedMealName: string;
  cookedMealDescription: string;
}

/**
 * 生成在家做饭方案。
 */
export async function planHomeCookingAgent(
  ingredientList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<HomeCookingPlan | undefined> {
  const systemPrompt = planHomeCookingPrompt({
    actionReason,
    availableIngredients: ingredientList,
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
            ingredients: z
              .array(z.enum(ingredientList.map((item) => item.value)).describe("选择的食材名称"))
              .min(1)
              .refine((items) => new Set(items).size === items.length, {
                message: "选择的食材不能重复",
              }),
            cookedMealName: z.string().describe("根据所选食材生成的料理名称"),
            cookedMealDescription: z
              .string()
              .describe("根据所选食材生成的简短料理描述，说明做出来的大致样子或味道"),
          }),
        }),
        prompt: systemPrompt,
      });
      logger.info("[planHomeCookingAgent] 生成在家做饭方案结果", output);
      return {
        ingredients: output.ingredients,
        cookedMealName: output.cookedMealName,
        cookedMealDescription: output.cookedMealDescription,
      };
    } catch (error) {
      logger.error("[planHomeCookingAgent] 生成在家做饭方案失败", error);
    }
  }
}

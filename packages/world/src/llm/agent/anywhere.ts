import type { ActionContext, BehaviorRecord, ChoiceOption, PlanState } from "@yuiju/utils";
import { chooseFoodPrompt, generateStructuredOutput } from "@yuiju/utils";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { type ParameterAgentSelectedItem, RETRY_COUNT } from "./shared";

/**
 *
 * 选择食物
 */
export async function chooseFoodAgent(
  foodList: ChoiceOption[],
  context: ActionContext,
  actionReason: string,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem[] | undefined> {
  const systemPrompt = chooseFoodPrompt({
    actionReason,
    availableFood: foodList,
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
                  value: z.enum(foodList.map((item) => item.value)).describe("选择的食物名称"),
                  quantity: z.number().describe("选择的数量"),
                }),
              )
              .describe("本次选择食用的食物列表"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseFoodAgent] 选择食物结果", output);
      return output.selectedList;
    } catch (error) {
      logger.error("[chooseFoodAgent] 选择食物失败", error);
    }
  }
}

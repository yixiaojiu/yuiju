import type { ActionAgentDecision, ActionContext, BehaviorRecord, PlanState } from "@yuiju/utils";
import { chooseShrinePrayerPrompt, generateStructuredOutput } from "@yuiju/utils";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { Output } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { RETRY_COUNT, type ShrinePrayerAgentDecision } from "./shared";

/**
 *
 * 选择神社参拜方式
 */
export async function chooseShrinePrayerAgent(
  context: ActionContext,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
  offeringCost: number,
  selectedAction: ActionAgentDecision,
): Promise<ShrinePrayerAgentDecision | undefined> {
  const systemPrompt = chooseShrinePrayerPrompt({
    actionReason: selectedAction.reason,
    characterState: context.characterStateData,
    worldState: context.worldState,
    offeringCost,
    longTermPlanTitle: planState.longTermPlan?.title,
    shortTermPlanTitles: planState.shortTermPlans.map((plan) => plan.title),
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
        providerOptions: {
          flash: {
            enable_thinking: false,
          },
        },
        output: Output.object({
          schema: z.object({
            shouldOffer: z.boolean().describe("这次是否投币参拜"),
            wish: z
              .string()
              .max(40)
              .nullable()
              .transform((value) => value ?? undefined)
              .describe("只有在投币时才填写的一句简短祈愿，不投币时填 null"),
          }),
        }),
        prompt: systemPrompt,
      });

      logger.info("[chooseShrinePrayerAgent] 神社参拜决策结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseShrinePrayerAgent] 神社参拜决策失败", error);
    }
  }
}

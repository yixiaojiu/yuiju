import type {
  ActionAgentDecision,
  ActionContext,
  ActionMetadata,
  BehaviorRecord,
  PlanState,
} from "@yuiju/utils";
import {
  agentPlanChangeSchema,
  chooseActionPrompt,
  createToolCallLoggingHooks,
  diarySearchTool,
  generateStructuredOutput,
  getPersonMemoryTool,
  listPersonMemoriesTool,
  queryAvailableInventoryItems,
  queryStaticGuideTool,
  readCoreMemory,
  reviewPlanChangesTool,
  todayEventSearchTool,
} from "@yuiju/utils";
import { getStrongModel } from "@yuiju/utils/llm/models";
import { Output, stepCountIs } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { RETRY_COUNT } from "./shared";

/**
 *
 * 选择 Action
 */
export async function chooseActionAgent(
  actionList: ActionMetadata[],
  context: ActionContext,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ActionAgentDecision | undefined> {
  const coreMemory = await readCoreMemory();
  const systemPrompt = chooseActionPrompt({
    actionList,
    characterState: context.characterStateData,
    worldState: context.worldState,
    eventDescription: context.eventDescription,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
    coreMemory: coreMemory ?? undefined,
    longTermPlanTitle: planState.longTermPlan?.title,
    shortTermPlanTitles: planState.shortTermPlans.map((plan) => plan.title),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: getStrongModel(),
        providerOptions: {
          strong: {
            enable_thinking: true,
          },
        },
        tools: {
          todayEventSearch: todayEventSearchTool,
          diarySearch: diarySearchTool,
          listPersonMemories: listPersonMemoriesTool,
          getPersonMemory: getPersonMemoryTool,
          queryAvailableInventoryItems,
          queryStaticGuide: queryStaticGuideTool,
          reviewPlanChanges: reviewPlanChangesTool(),
        },
        output: Output.object({
          schema: z.object({
            action: z
              .enum(actionList?.map((item) => item.action))
              .describe("Action ID，例如：发呆、起床等"),
            reason: z
              .string()
              .describe(
                "选择这个 Action 的原因。如果这个 Action 后续有子决策，这个原因会作为后续决策的参考",
              ),
            durationMinute: z
              .number()
              .nullable()
              .transform((value) => value ?? undefined)
              .describe("Action持续多少分钟，只有特殊的Action需要给出持续时间，其余情况填 null"),
            planChanges: z
              .array(agentPlanChangeSchema)
              .min(1)
              .nullable()
              .transform((value) => value ?? undefined)
              .describe("需要调整计划时才填写，否则填 null。填写前必须先调用 reviewPlanChanges。"),
            proactiveShareIntent: z
              .object({
                shouldShare: z.boolean().describe("是否想向别人分享点什么"),
                reason: z.string(),
              })
              .nullable()
              .transform((value) => value ?? undefined)
              .describe("当你想向别人分享点什么的时候才填写，否则填 null"),
          }),
        }),
        prompt: systemPrompt,
        stopWhen: stepCountIs(20),
        ...createToolCallLoggingHooks({
          scene: "world.llm.choose-action",
        }),
      });

      logger.info("[chooseActionAgent] 选择行动结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseActionAgent] 选择行动失败", error);
    }
  }
}

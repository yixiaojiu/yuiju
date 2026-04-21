import type {
  ActionAgentDecision,
  ActionContext,
  ActionMetadata,
  BehaviorRecord,
  ChoiceOption,
  PlanState,
} from "@yuiju/utils";
import {
  chooseActionPrompt,
  chooseCafeCoffeePrompt,
  chooseFoodPrompt,
  chooseShopProductPrompt,
  chooseShrinePrayerPrompt,
  diarySearchTool,
  generateStructuredOutput,
  getPersonMemoryTool,
  listPersonMemoriesTool,
  queryWorldMapTool,
  qwen3Model,
  reviewPlanChangesTool,
  strongModel,
  todayEventSearchTool,
} from "@yuiju/utils";
import { Output, stepCountIs } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { queryAvailableFood } from "./tools";

const RETRY_COUNT = 3;

const agentPlanChangeSchema = z.object({
  scope: z.enum(["longTerm", "shortTerm"]).describe("计划类型，长期计划还是短期计划"),
  changeType: z.enum(["created", "updated", "abandoned", "completed"]).describe("计划变更类型。"),
  currentPlan: z.string().optional().describe("原计划内容"),
  nextPlan: z.string().optional().describe("新计划内容"),
  reason: z.string().describe("这次变更的原因。"),
});

type ParameterAgentSelectedItem = {
  value: string;
  quantity: number;
};

export type FoodAgentDecision = {
  selectedList: ParameterAgentSelectedItem[];
};

export type ShopProductAgentDecision = {
  selectedList: ParameterAgentSelectedItem[];
};

export type ShrinePrayerAgentDecision = {
  shouldOffer: boolean;
  wish?: string;
};

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
  const systemPrompt = chooseActionPrompt({
    actionList,
    characterState: context.characterState,
    worldState: context.worldState,
    eventDescription: context.eventDescription,
    recentBehaviorList: actionMemoryList.map((item) => ({
      behavior: item.behavior,
      description: item.description,
      time: dayjs(item.timestamp),
    })),
    longTermPlanTitle: planState.longTermPlan?.title,
    shortTermPlanTitles: planState.shortTermPlans.map((plan) => plan.title),
  });

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const { output } = await generateStructuredOutput({
        model: qwen3Model,
        providerOptions: {
          Siliconflow: {
            enable_thinking: true,
          },
        },
        tools: {
          todayEventSearch: todayEventSearchTool,
          diarySearch: diarySearchTool,
          listPersonMemories: listPersonMemoriesTool,
          getPersonMemory: getPersonMemoryTool,
          queryAvailableFood: queryAvailableFood(context),
          queryWorldMap: queryWorldMapTool,
          reviewPlanChanges: reviewPlanChangesTool({
            planState,
            characterState: context.characterState.log(),
            worldState: context.worldState.log(),
            eventDescription: context.eventDescription,
            recentBehaviorList: actionMemoryList,
          }),
        },
        output: Output.object({
          schema: z.object({
            action: z
              .enum(actionList?.map((item) => item.action))
              .describe("Action ID，例如：发呆、起床等"),
            reason: z.string().describe("选择这个 Action 的简短原因"),
            durationMinute: z
              .number()
              .optional()
              .describe("Action持续多少分钟，只有特殊的Action需要给出持续时间"),
            planChanges: z
              .array(agentPlanChangeSchema)
              .min(1)
              .optional()
              .describe("只有确实需要调整计划时才输出。输出前必须先调用 reviewPlanChanges。"),
          }),
        }),
        prompt: systemPrompt,
        stopWhen: stepCountIs(20),
      });

      logger.info("[chooseActionAgent] 选择行动结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseActionAgent] 选择行动失败", error);
    }
  }
}

/**
 *
 * 选择食物
 */
export async function chooseFoodAgent(
  foodList: ChoiceOption[],
  context: ActionContext,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem[] | undefined> {
  const systemPrompt = chooseFoodPrompt({
    availableFood: foodList,
    characterState: context.characterState,
    worldState: context.worldState,
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
        model: strongModel,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
        output: Output.object({
          schema: z.array(
            z.object({
              value: z.enum(foodList.map((item) => item.value)).describe("选择的食物名称"),
              quantity: z.number().describe("选择的数量"),
            }),
          ),
        }),
        prompt: systemPrompt,
      });
      // LLM 返回的是数组，需要包装成 selectedList 格式
      logger.info("[chooseFoodAgent] 选择食物结果", output);
      return output;
    } catch (error) {
      logger.error("[chooseFoodAgent] 选择食物失败", error);
    }
  }
}

/**
 *
 * 选择购买商品
 */
export async function chooseShopProductAgent(
  productList: ChoiceOption[],
  context: ActionContext,
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem | undefined> {
  if (productList.length === 0) {
    return;
  }

  const systemPrompt = chooseShopProductPrompt({
    availableProducts: productList,
    characterState: context.characterState,
    worldState: context.worldState,
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
        model: qwen3Model,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
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
  actionMemoryList: BehaviorRecord[],
  planState: PlanState,
): Promise<ParameterAgentSelectedItem | undefined> {
  if (coffeeList.length === 0) {
    return;
  }

  const systemPrompt = chooseCafeCoffeePrompt({
    availableCoffees: coffeeList,
    characterState: context.characterState,
    worldState: context.worldState,
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
        model: qwen3Model,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
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
    characterState: context.characterState,
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
        model: strongModel,
        providerOptions: {
          Siliconflow: {
            enable_thinking: false,
          },
        },
        output: Output.object({
          schema: z.object({
            shouldOffer: z.boolean().describe("这次是否投币参拜"),
            wish: z.string().max(40).optional().describe("只有在投币时才填写的一句简短祈愿"),
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

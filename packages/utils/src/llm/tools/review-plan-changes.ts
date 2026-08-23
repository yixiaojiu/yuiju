import { Output, stepCountIs, tool } from "ai";
import { z } from "zod";
import { planManager } from "../../memory";
import {
  buildPlanChangeReviewUserPrompt,
  type PlanChangeReviewChatContextPromptInput,
  planChangeReviewSystemPrompt,
} from "../../prompt";
import type { AgentPlanChange } from "../../types";
import { generateStructuredOutput } from "../generate-structured-output";
import { getFlashModel } from "../models";
import { createToolCallLoggingHooks } from "../tool-call-logger";
import { queryStateTool } from "./query-state";
import { agentPlanChangeToolSchema } from "./schema";

const reviewResultSchema = z.object({
  approved: z.boolean().describe("是否通过审查。"),
  reason: z.string().describe("审查结论。"),
  issues: z
    .array(z.string())
    .nullable()
    .transform((value) => value ?? undefined)
    .describe("未通过时需要修正的问题列表。"),
});

type PlanChangeReviewResult = z.infer<typeof reviewResultSchema>;

export type PlanChangeReviewChatContext = PlanChangeReviewChatContextPromptInput;

export interface ReviewPlanChangesInput {
  planChanges: AgentPlanChange[];
  chatContext?: PlanChangeReviewChatContext;
}

export async function reviewPlanChanges(
  input: ReviewPlanChangesInput,
): Promise<PlanChangeReviewResult> {
  const planState = await planManager.getState();

  const { output } = await generateStructuredOutput({
    model: getFlashModel(),
    output: Output.object({
      schema: reviewResultSchema,
    }),
    tools: {
      queryStateTool,
    },
    instructions: planChangeReviewSystemPrompt,
    stopWhen: stepCountIs(20),
    ...createToolCallLoggingHooks({
      scene: "utils.llm.review-plan-changes",
    }),
    messages: [
      {
        role: "user",
        content: buildPlanChangeReviewUserPrompt({
          ...input,
          planState,
        }),
      },
    ],
  });

  return output;
}

export function reviewPlanChangesTool(input: { chatContext?: PlanChangeReviewChatContext } = {}) {
  return tool({
    description:
      "审查候选 planChanges 是否合理。只有审查通过后，才能把 planChanges 写进最终 JSON。",
    inputSchema: z.object({
      planChanges: z
        .array(agentPlanChangeToolSchema)
        .min(1)
        .describe("候选计划变更。必须传入你准备写进最终 JSON 的完整 planChanges。"),
    }),
    execute: async ({ planChanges }) => {
      return reviewPlanChanges({
        ...input,
        planChanges,
      });
    },
  });
}

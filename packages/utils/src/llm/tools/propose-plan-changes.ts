import { tool } from "ai";
import { z } from "zod";
import { saveMemoryEpisode } from "../../db";
import { isDev } from "../../env";
import { logger } from "../../logger";
import { buildPlanUpdateEpisodes, planManager } from "../../memory";
import type { AgentPlanChange } from "../../types";
import { reviewPlanChanges } from "./review-plan-changes";
import { agentPlanChangeToolSchema } from "./schema";

export interface CreateChatPlanChangesProposalToolInput {
  summary?: string;
  historyJson: string;
}

export async function reviewAndApplyChatPlanChanges(input: {
  planChanges: AgentPlanChange[];
  summary?: string;
  historyJson: string;
}) {
  logger.info("[message.plan] 聊天计划变更提案", {
    planChanges: input.planChanges,
  });
  const reviewResult = await reviewPlanChanges({
    planChanges: input.planChanges,
    chatContext: {
      summary: input.summary,
      historyJson: input.historyJson,
    },
  });

  if (!reviewResult.approved) {
    logger.info("[message.plan] 聊天计划变更提案未通过审查", {
      reason: reviewResult.reason,
      issues: reviewResult.issues,
      planChanges: input.planChanges,
    });
    return;
  }

  const appliedPlanChanges = (await planManager.applyPlanChanges(input.planChanges)).changes;
  if (appliedPlanChanges.length === 0) {
    return;
  }

  const planEpisodes = buildPlanUpdateEpisodes({
    changes: appliedPlanChanges,
    happenedAt: new Date(),
    isDev: isDev(),
    source: "chat",
    changeReasonPrefix: "本次聊天",
  });

  for (const planEpisode of planEpisodes) {
    await saveMemoryEpisode(planEpisode);
  }

  logger.info("[message.plan] 聊天计划变更已应用", {
    changes: appliedPlanChanges,
  });
}

export function createCollectedChatPlanChangesProposalTool(input: {
  canCollect: boolean;
  collect: (planChanges: AgentPlanChange[]) => void;
}) {
  let hasCollected = false;

  return tool({
    description: "记录计划变更提案；当前只收集提案，社交行动成功结束后才会审查并应用。",
    inputSchema: z.object({
      planChanges: z.array(agentPlanChangeToolSchema).min(1).describe("候选计划变更"),
    }),
    execute: async ({ planChanges }) => {
      if (!input.canCollect || hasCollected) {
        return {
          status: "rejected",
          message: "当前逻辑轮次已经记录过一次计划变更提案。",
        };
      }

      hasCollected = true;
      input.collect(planChanges);
      return {
        status: "collected",
        message: "计划变更提案已记录，当前尚未应用。",
      };
    },
  });
}

export function createChatPlanChangesProposalTool(input: CreateChatPlanChangesProposalToolInput) {
  return tool({
    description: "提交计划变更提案",
    inputSchema: z.object({
      planChanges: z.array(agentPlanChangeToolSchema).min(1).describe("候选计划变更"),
    }),
    execute: async ({ planChanges }) => {
      reviewAndApplyChatPlanChanges({
        planChanges,
        summary: input.summary,
        historyJson: input.historyJson,
      }).catch((error) => {
        logger.error("[message.plan] 处理聊天计划变更提案失败", {
          planChanges,
          error,
        });
      });

      return {
        status: "queued",
        message: "计划变更提案已提交后台审查，当前不代表已经生效。",
      };
    },
  });
}

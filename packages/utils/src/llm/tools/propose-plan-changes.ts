import { tool } from "ai";
import { z } from "zod";
import { isDev } from "../../env";
import { logger } from "../../logger";
import { buildPlanUpdateEpisodes, emitMemoryEpisode, planManager } from "../../memory";
import type { AgentPlanChange } from "../../types";
import { reviewPlanChanges } from "./review-plan-changes";
import { agentPlanChangeSchema } from "./schema";

export interface CreateChatPlanChangesProposalToolInput {
  scene: "private" | "group";
  summary?: string;
  historyJson: string;
}

async function reviewAndApplyChatPlanChanges(input: {
  planChanges: AgentPlanChange[];
  scene: "private" | "group";
  summary?: string;
  historyJson: string;
}) {
  const sceneText = input.scene === "private" ? "私聊" : "群聊";
  const logPrefix = input.scene === "private" ? "[message.plan.private]" : "[message.plan.group]";

  logger.info(`${logPrefix} ${sceneText}计划变更提案`, {
    planChanges: input.planChanges,
  });
  const reviewResult = await reviewPlanChanges({
    planChanges: input.planChanges,
    chatContext: {
      scene: input.scene,
      summary: input.summary,
      historyJson: input.historyJson,
    },
  });

  if (!reviewResult.approved) {
    logger.info(`${logPrefix} ${sceneText}计划变更提案未通过审查`, {
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
    changeReasonPrefix: `本次${sceneText}`,
  });

  for (const planEpisode of planEpisodes) {
    await emitMemoryEpisode(planEpisode);
  }

  logger.info(`${logPrefix} ${sceneText}计划变更已应用`, {
    changes: appliedPlanChanges,
  });
}

export function createChatPlanChangesProposalTool(input: CreateChatPlanChangesProposalToolInput) {
  return tool({
    description: "提交计划变更提案",
    inputSchema: z.object({
      planChanges: z.array(agentPlanChangeSchema).min(1).describe("候选计划变更"),
    }),
    execute: async ({ planChanges }) => {
      reviewAndApplyChatPlanChanges({
        planChanges,
        scene: input.scene,
        summary: input.summary,
        historyJson: input.historyJson,
      }).catch((error) => {
        const logPrefix =
          input.scene === "private" ? "[message.plan.private]" : "[message.plan.group]";

        logger.error(`${logPrefix} 处理计划变更提案失败`, {
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

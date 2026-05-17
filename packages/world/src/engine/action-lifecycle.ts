import { setTimeout } from "node:timers/promises";
import {
  type ActionAgentDecision,
  type ActionContext,
  ActionId,
  buildPlanUpdateEpisodes,
  emitMemoryEpisode,
  getMemoryEpisodeById,
  getRecentMemoryEpisodes,
  isDev,
  type PlanChange,
  planManager,
  SUBJECT_NAME,
  updateMemoryEpisodeById,
} from "@yuiju/utils";
import dayjs from "dayjs";
import { getActionList } from "@/action";
import { getActionById } from "@/action/utils";
import { chooseActionAgent } from "@/llm/agent";
import {
  type BehaviorEpisodePayload,
  buildCompletedBehaviorEpisodeUpdate,
  buildRunningBehaviorEpisode,
} from "@/memory/episode-builder";
import { characterState } from "@/state/character-state";
import { worldState } from "@/state/world-state";
import { logger } from "@/utils/logger";
import { scheduleActionCompletionProactiveShare } from "./proactive-message";

async function getDurationTime(
  durationMin:
    | number
    | ((context: ActionContext, selectedAction?: ActionAgentDecision) => Promise<number>),
  context: ActionContext,
  selectedAction?: ActionAgentDecision,
) {
  if (typeof durationMin === "function") {
    return durationMin(context, selectedAction);
  } else {
    return durationMin;
  }
}

interface ActionStartTickResult {
  nextTickInMinutes: number;
  runningAction?: {
    action: ActionId;
    actionStartedAt: string;
    reason: string;
    durationMinutes: number;
    executionResult?: string;
    startContext?: Record<string, unknown>;
    proactiveShareIntent?: ActionAgentDecision["proactiveShareIntent"];
  };
}

/**
 * 选择并开始一个 Action。
 *
 * 流程：
 * - 构建 ActionContext，并让 LLM 在当前可执行 Action 中选择一个；
 * - 应用本次决策携带的 planChanges；
 * - 执行 Action executor，完成“开始 Action”的即时副作用；
 * - 计算持续时间，并把进入 running 阶段所需的信息返回给后续流程。
 */
async function startAction(eventDescription?: string): Promise<ActionStartTickResult> {
  const context: ActionContext = {
    characterState,
    worldState,
    eventDescription,
  };

  const actionList = getActionList(context);
  const planState = await planManager.getState();

  if (actionList.length === 0) {
    const idleAction = getActionById(ActionId.Idle);
    logger.error("[action-lifecycle] action list is empty");

    const durationMin = await getDurationTime(idleAction.durationMin, context);
    return { nextTickInMinutes: durationMin };
  }

  logger.info(
    `[action-lifecycle] Available actions: [${actionList.map((a) => a.action).join(", ")}]`,
  );

  const recentBehaviors = await getRecentMemoryEpisodes({
    limit: 10,
    types: ["behavior"],
    subject: SUBJECT_NAME,
    isDev: isDev(),
    onlyDate: new Date(),
  });
  const history = recentBehaviors.map((behavior) => ({
    behavior: String(behavior.payload.action ?? ActionId.Idle) as ActionId,
    description: String(behavior.payload.reason ?? behavior.summaryText),
    timestamp: behavior.happenedAt.getTime(),
  }));

  const selectedAction = await chooseActionAgent(actionList, context, history, planState);
  const actionMetadata = actionList.find((item) => item.action === selectedAction?.action);

  if (actionMetadata && selectedAction) {
    const actionStartedAt = new Date();
    let planChanges: PlanChange[] = [];
    const agentPlanChanges = selectedAction.planChanges;

    if (agentPlanChanges?.length) {
      try {
        planChanges = (await planManager.applyPlanChanges(agentPlanChanges)).changes;
      } catch (error) {
        logger.warn("[action-lifecycle] apply planChanges failed, ignore current planChanges", {
          error,
          planChanges: agentPlanChanges,
        });
      }
    }

    if (planChanges.length > 0) {
      const planEpisodes = buildPlanUpdateEpisodes({
        changes: planChanges,
        happenedAt: new Date(),
        isDev: isDev(),
      });

      for (const planEpisode of planEpisodes) {
        try {
          await emitMemoryEpisode(planEpisode);
          logger.info("[action-lifecycle] built plan_update episode", planEpisode);
        } catch (error) {
          logger.error("[action-lifecycle] write plan_update episode failed", error);
        }
      }
    }

    const actionStartResult = await actionMetadata.executor(context, selectedAction);

    await context.worldState.updateTime();

    const durationMin = await getDurationTime(actionMetadata.durationMin, context, selectedAction);

    logger.info(
      `[action-lifecycle startAction] Duration ${durationMin} min, selectedAction: `,
      selectedAction,
    );

    return {
      nextTickInMinutes: durationMin,
      runningAction: {
        action: selectedAction.action,
        actionStartedAt: actionStartedAt.toISOString(),
        reason: selectedAction.reason,
        durationMinutes: durationMin,
        executionResult: actionStartResult?.executionResult,
        startContext: actionStartResult?.startContext,
        proactiveShareIntent: selectedAction.proactiveShareIntent,
      },
    };
  } else {
    const idleAction = getActionById(ActionId.Idle);
    logger.error("[action-lifecycle] LLM selected action is not executable.", selectedAction);
    const durationMin = await getDurationTime(idleAction.durationMin, context);
    return { nextTickInMinutes: durationMin };
  }
}

/**
 * 恢复并完成 Redis 中正在运行的 action。
 *
 * 流程：
 * - 从 Redis 读取 runningAction；
 * - 等待到 waitUntil，若进程重启后时间已过则直接进入完成流程；
 * - 等待结束后执行 completionEvent，完成状态结算并得到下一次 tick 的事件描述；
 * - 使用 behaviorEpisodeId 将同一条 behavior Episode 从 running 更新为 completed；
 * - Episode 更新成功后清理 Redis 运行态。
 */
export async function recoverRunningAction(): Promise<string | undefined> {
  const runningAction = characterState.getRunningAction();

  if (!runningAction) {
    return undefined;
  }

  const remainingMs = Math.max(dayjs(runningAction.waitUntil).diff(dayjs()), 0);

  if (remainingMs > 0) {
    await setTimeout(remainingMs);
  }

  const context = {
    characterState,
    worldState,
  };
  const actionMetadata = getActionById(runningAction.action);
  const completionResult = await actionMetadata.completionEvent?.(context, runningAction);

  const runningEpisode = await getMemoryEpisodeById(runningAction.behaviorEpisodeId);
  if (!runningEpisode) {
    throw new Error(`Running behavior episode not found: ${runningAction.behaviorEpisodeId}`);
  }

  const completedEpisode = buildCompletedBehaviorEpisodeUpdate({
    context,
    runningAction,
    runningPayload: runningEpisode.payload as BehaviorEpisodePayload,
    completionContext: completionResult?.completionContext,
    eventDescription: completionResult?.eventDescription,
  });

  const updatedEpisode = await updateMemoryEpisodeById(runningAction.behaviorEpisodeId, {
    summaryText: completedEpisode.summaryText,
    payload: completedEpisode.payload,
  });

  if (!updatedEpisode) {
    throw new Error(`Update behavior episode failed: ${runningAction.behaviorEpisodeId}`);
  }

  scheduleActionCompletionProactiveShare({
    actionMetadata,
    runningAction,
    eventDescription: completionResult?.eventDescription,
    completionContext: completionResult?.completionContext,
    characterStateSnapshot: context.characterState.log(),
    worldStateSnapshot: context.worldState.log(),
  });

  await characterState.clearRunningAction();
  return completionResult?.eventDescription;
}

/**
 * 启动下一次 Action。
 *
 * 流程：
 * - 更新时间并开始一次 Action；
 * - 如果没有需要等待的 Action，按返回的分钟数等待后结束本轮；
 * - 如果 Action 进入 running，先写 running behavior Episode；
 * - 将 behaviorEpisodeId 和 startContext 写入 Redis runningAction；
 * - 进入恢复/完成流程，最终返回下一次 tick 的事件描述。
 */
export async function runNextAction(eventDescription?: string): Promise<string | undefined> {
  await worldState.updateTime();

  const actionStartResult = await startAction(eventDescription);

  if (!actionStartResult.runningAction) {
    await setTimeout(actionStartResult.nextTickInMinutes * 60 * 1000);
    return undefined;
  }

  const waitUntil = dayjs().add(actionStartResult.nextTickInMinutes, "minute").toISOString();
  const behaviorEpisode = buildRunningBehaviorEpisode({
    context: {
      characterState,
      worldState,
    },
    selectedAction: {
      action: actionStartResult.runningAction.action,
      reason: actionStartResult.runningAction.reason,
    },
    executionResult: actionStartResult.runningAction.executionResult,
    startContext: actionStartResult.runningAction.startContext,
    durationMinutes: actionStartResult.runningAction.durationMinutes,
    happenedAt: new Date(actionStartResult.runningAction.actionStartedAt),
    isDev: isDev(),
  });

  if (!behaviorEpisode) {
    await setTimeout(actionStartResult.nextTickInMinutes * 60 * 1000);
    return undefined;
  }

  // TODO：需要重命名一下
  const behaviorEpisodeId = await emitMemoryEpisode(behaviorEpisode);
  if (!behaviorEpisodeId) {
    throw new Error("[action-lifecycle] write running behavior episode failed");
  }

  await characterState.setRunningAction({
    action: actionStartResult.runningAction.action,
    actionStartedAt: actionStartResult.runningAction.actionStartedAt,
    waitUntil,
    behaviorEpisodeId,
    startContext: actionStartResult.runningAction.startContext,
    proactiveShareIntent: actionStartResult.runningAction.proactiveShareIntent,
  });

  return recoverRunningAction();
}

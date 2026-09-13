import { setTimeout } from "node:timers/promises";
import type { Session } from "@satorijs/core";
import { reportAnalyticsEvent } from "@yuiju/utils/analytics/report-event";
import { reviewAndApplyChatPlanChanges } from "@yuiju/utils/llm/tools/propose-plan-changes";
import { initCharacterStateData } from "@yuiju/utils/redis/state/character";
import { ActionId } from "@yuiju/utils/types/action";
import { chatManager } from "@/chat/manager";
import { logger } from "@/utils/logger";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";
import { runChatPlanner } from "./planner";
import { compressPlannerContextIfNeeded } from "./planner-context-compression";
import {
  appendPlannerOutcome,
  appendPlannerTurn,
  markPlannerMessagesProcessed,
} from "./planner-session";
import { sendChatPoke } from "./poke";
import { generateChatReply } from "./replyer";
import { PlannerReplyerPartialSendError, sendChatSegments } from "./sender";
import { splitChatReply } from "./split-reply";
import { selectChatSticker } from "./sticker-selector";
import { BACKOFF_DELAYS_MS, evaluateChatTrigger, isDirectedChatMessage } from "./trigger";
import type { PlannerReplyerConversationRuntime, PlannerReplyerResult } from "./types";

const MAX_FAILED_ACTION_ATTEMPTS = 2;

interface ChatReplyPerformance {
  startedAt: number;
  initialBatchMessageCount: number;
  strategy: "planner_replyer";
  platform: "onebot";
  trigger_type: "directed" | "attention" | "necessity";
  planner_duration_ms: number;
  replyer_duration_ms: number;
  wait_duration_ms: number;
  sticker_selector_duration_ms: number;
  split_duration_ms: number;
  segment_delay_duration_ms: number;
  platform_send_duration_ms: number;
  planner_call_count: number;
  tool_call_count: number;
  batch_message_count: number;
  new_message_count: number;
  sent_message_count: number;
  first_reply_duration_ms?: number;
}

interface ChatActionExecution {
  performed: boolean;
  complete: boolean;
  outcome: string;
  replyerDurationMs: number;
  stickerSelectorDurationMs: number;
  splitDurationMs: number;
  segmentDelayDurationMs: number;
  platformSendDurationMs: number;
  sentMessageCount: number;
  firstSendCompletedAt?: number;
}

class PlannerReplyerGroupChatManager {
  private readonly runtimeBySessionId = new Map<string, PlannerReplyerConversationRuntime>();

  async handleMessage(input: {
    session: Session;
    storedMessage: StoredSatoriGroupMessage;
    forceTrigger?: boolean;
  }): Promise<void> {
    const runtime = this.getRuntime(input.storedMessage.sessionId);
    runtime.replyTaskVersion += 1;
    runtime.replyController?.abort("new group message arrived");

    const characterState = await initCharacterStateData();
    if (characterState.action === ActionId.Sleep) {
      return;
    }

    if (
      !runtime.pendingMessages.some(
        (message) => message.messageId === input.storedMessage.messageId,
      )
    ) {
      runtime.pendingMessages.push(input.storedMessage);
    }
    runtime.forceTrigger ||=
      input.forceTrigger === true || isDirectedChatMessage(input.session, input.storedMessage);

    if (runtime.running) {
      logger.info("[message.planner-replyer] 新消息进入下一待处理批次", {
        sessionId: runtime.sessionId,
        messageId: input.storedMessage.messageId,
        pendingCount: runtime.pendingMessages.length,
      });
      return;
    }

    await this.run(input.session, runtime);
  }

  private async run(session: Session, runtime: PlannerReplyerConversationRuntime): Promise<void> {
    let gateBypassReason: "wait_resume" | "stale_retry" | "action_retry" | undefined;
    let waitResult: string | undefined;
    let failedActionAttempts = 0;
    let carriedPlanChanges: PlannerReplyerResult["planChanges"] = [];
    let performance: ChatReplyPerformance | undefined;
    runtime.running = true;

    try {
      while (runtime.pendingMessages.length) {
        if (runtime.pendingMessages.length >= 6) {
          runtime.nextEligibleAt = 0;
        }

        const trigger = evaluateChatTrigger({
          pendingMessages: runtime.pendingMessages,
          history: chatManager.groupSession.getMessages(runtime.sessionId),
          forceTrigger: runtime.forceTrigger,
          nextEligibleAt: runtime.nextEligibleAt,
          now: Date.now(),
        });
        if (!gateBypassReason && !trigger.shouldRun) {
          logger.info("[message.planner-replyer.trigger] 普通消息继续旁听", {
            sessionId: runtime.sessionId,
            pendingCount: runtime.pendingMessages.length,
            nextEligibleAt: runtime.nextEligibleAt,
            ...trigger,
          });
          return;
        }

        logger.info("[message.planner-replyer.trigger] 调度 Planner", {
          sessionId: runtime.sessionId,
          pendingCount: runtime.pendingMessages.length,
          reason: gateBypassReason ?? trigger.kind,
          contentScore: trigger.contentScore,
          messagePressureScore: trigger.messagePressureScore,
          idleBonus: trigger.idleBonus,
          recentPresencePenalty: trigger.recentPresencePenalty,
          totalScore: trigger.totalScore,
        });

        if (!performance) {
          performance = {
            startedAt: Date.now(),
            initialBatchMessageCount: runtime.pendingMessages.length,
            strategy: "planner_replyer",
            platform: "onebot",
            trigger_type: trigger.kind as ChatReplyPerformance["trigger_type"],
            planner_duration_ms: 0,
            replyer_duration_ms: 0,
            wait_duration_ms: 0,
            sticker_selector_duration_ms: 0,
            split_duration_ms: 0,
            segment_delay_duration_ms: 0,
            platform_send_duration_ms: 0,
            planner_call_count: 0,
            tool_call_count: 0,
            batch_message_count: runtime.pendingMessages.length,
            new_message_count: 0,
            sent_message_count: 0,
          };
        }

        gateBypassReason = undefined;
        const consumedForceTrigger = runtime.forceTrigger;
        runtime.forceTrigger = false;
        const boundaryCount = runtime.pendingMessages.length;
        const boundaryVersion = runtime.replyTaskVersion;
        const batch = runtime.pendingMessages.slice(0, boundaryCount);
        const recentMessages = chatManager.groupSession.getMessages(runtime.sessionId);
        let plannerResult: PlannerReplyerResult;
        performance.batch_message_count = Math.max(performance.batch_message_count, batch.length);
        performance.new_message_count = Math.max(
          performance.new_message_count,
          batch.length - performance.initialBatchMessageCount,
        );
        performance.planner_call_count += 1;
        const plannerStartedAt = Date.now();

        try {
          plannerResult = await runChatPlanner({
            sessionId: runtime.sessionId,
            pendingMessages: batch,
            recentMessages,
            waitResult,
            canProposePlanChanges: carriedPlanChanges.length === 0,
          });
        } catch (error) {
          performance.planner_duration_ms += Date.now() - plannerStartedAt;
          runtime.forceTrigger ||= consumedForceTrigger;
          logger.error("[message.planner-replyer.planner] Planner 调用失败", {
            sessionId: runtime.sessionId,
            error,
          });
          this.reportPerformance(performance, {
            action_type: "unknown",
            outcome: "failed",
            failure_stage: "planner",
          });
          performance = undefined;
          return;
        }
        performance.planner_duration_ms += Date.now() - plannerStartedAt;
        performance.tool_call_count += plannerResult.toolCallCount;
        waitResult = undefined;

        if (plannerResult.action.type !== "wait") {
          await appendPlannerTurn({
            sessionId: runtime.sessionId,
            realMessageIds: batch.map((message) => message.messageId),
            messages: plannerResult.turnMessages,
            maxInputTokens: plannerResult.maxInputTokens,
          });
        }

        const hasNewerMessages = runtime.replyTaskVersion !== boundaryVersion;
        if (
          hasNewerMessages &&
          (plannerResult.action.type === "reply" ||
            plannerResult.action.type === "sendSticker" ||
            plannerResult.action.type === "poke")
        ) {
          carriedPlanChanges = [];
          await appendPlannerOutcome(
            runtime.sessionId,
            "判断期间出现了更新消息，这个行动已经过时，没有执行。",
          );
          gateBypassReason = "stale_retry";
          continue;
        }

        if (plannerResult.action.type === "wait") {
          failedActionAttempts = 0;
          carriedPlanChanges.push(...plannerResult.planChanges);
          runtime.consecutiveNoActionCount = 0;
          runtime.backoffLevel = 0;
          runtime.nextEligibleAt = 0;
          if (runtime.consecutiveWaitCount >= 3) {
            this.reportPerformance(performance, {
              action_type: "wait",
              outcome: "silent",
            });
            performance = undefined;
            await appendPlannerTurn({
              sessionId: runtime.sessionId,
              realMessageIds: batch.map((message) => message.messageId),
              messages: plannerResult.turnMessages,
              maxInputTokens: plannerResult.maxInputTokens,
            });
            await appendPlannerOutcome(
              runtime.sessionId,
              "已经连续等待三次，本次不再等待，回到普通旁听状态。",
            );
            await this.consumeBatch(runtime, batch);
            await this.commitPlanChanges(runtime.sessionId, carriedPlanChanges);
            await compressPlannerContextIfNeeded(runtime.sessionId);
            return;
          }

          runtime.consecutiveWaitCount += 1;
          const waitStartedAt = Date.now();
          const pendingCountBeforeWait = runtime.pendingMessages.length;
          await setTimeout(plannerResult.action.seconds * 1000);
          const actualWaitSeconds = Math.round((Date.now() - waitStartedAt) / 1000);
          performance.wait_duration_ms += Date.now() - waitStartedAt;
          const receivedNewMessage = runtime.pendingMessages.length > pendingCountBeforeWait;
          waitResult = `计划等待 ${plannerResult.action.seconds} 秒，实际等待 ${actualWaitSeconds} 秒；等待期间${receivedNewMessage ? "收到" : "没有收到"}新消息。`;
          await appendPlannerTurn({
            sessionId: runtime.sessionId,
            realMessageIds: batch.map((message) => message.messageId),
            messages: plannerResult.turnMessages,
            maxInputTokens: plannerResult.maxInputTokens,
          });
          await appendPlannerOutcome(runtime.sessionId, waitResult);
          gateBypassReason = "wait_resume";
          continue;
        }

        runtime.consecutiveWaitCount = 0;
        const planChanges = [...carriedPlanChanges, ...plannerResult.planChanges];
        carriedPlanChanges = [];
        if (plannerResult.action.type === "none") {
          this.reportPerformance(performance, {
            action_type: "none",
            outcome: "silent",
          });
          performance = undefined;
          await appendPlannerOutcome(
            runtime.sessionId,
            plannerResult.internalNote
              ? `选择继续旁听：${plannerResult.internalNote}`
              : "本轮选择继续旁听。",
          );
          await this.consumeBatch(runtime, batch);
          runtime.consecutiveNoActionCount += 1;
          if (runtime.consecutiveNoActionCount >= 2) {
            const delay =
              BACKOFF_DELAYS_MS[Math.min(runtime.backoffLevel, BACKOFF_DELAYS_MS.length - 1)];
            runtime.nextEligibleAt = Date.now() + delay;
            runtime.backoffLevel = Math.min(runtime.backoffLevel + 1, BACKOFF_DELAYS_MS.length - 1);
          }
          await this.commitPlanChanges(runtime.sessionId, planChanges);
          await compressPlannerContextIfNeeded(runtime.sessionId);
          continue;
        }

        let actionExecution: ChatActionExecution;
        try {
          actionExecution = await this.executeAction({
            session,
            runtime,
            batch,
            result: plannerResult,
            taskVersion: boundaryVersion,
          });
        } catch (error) {
          failedActionAttempts += 1;
          const sentCount = error instanceof PlannerReplyerPartialSendError ? error.sentCount : 0;
          if (error instanceof PlannerReplyerPartialSendError) {
            performance.platform_send_duration_ms += error.platformSendDurationMs;
            performance.segment_delay_duration_ms += error.segmentDelayDurationMs;
            performance.sent_message_count += error.sentCount;
            if (error.firstSendCompletedAt) {
              performance.first_reply_duration_ms ??=
                error.firstSendCompletedAt - performance.startedAt;
            }
          }
          if (sentCount > 0) {
            await this.consumeBatch(runtime, batch);
          }
          await appendPlannerOutcome(
            runtime.sessionId,
            `行动执行失败：${error instanceof Error ? error.message : String(error)}`,
          );
          logger.error("[message.planner-replyer.action] 行动执行失败", {
            sessionId: runtime.sessionId,
            action: plannerResult.action.type,
            sentCount,
            error,
          });
          if (sentCount > 0 || failedActionAttempts >= MAX_FAILED_ACTION_ATTEMPTS) {
            this.reportPerformance(performance, {
              action_type:
                plannerResult.action.type === "sendSticker"
                  ? "send_sticker"
                  : plannerResult.action.type,
              outcome: "failed",
              failure_stage: "action",
            });
            performance = undefined;
            return;
          }
          carriedPlanChanges = [];
          gateBypassReason = "action_retry";
          continue;
        }

        performance.replyer_duration_ms += actionExecution.replyerDurationMs;
        performance.sticker_selector_duration_ms += actionExecution.stickerSelectorDurationMs;
        performance.split_duration_ms += actionExecution.splitDurationMs;
        performance.segment_delay_duration_ms += actionExecution.segmentDelayDurationMs;
        performance.platform_send_duration_ms += actionExecution.platformSendDurationMs;
        performance.sent_message_count += actionExecution.sentMessageCount;
        if (actionExecution.firstSendCompletedAt) {
          performance.first_reply_duration_ms ??=
            actionExecution.firstSendCompletedAt - performance.startedAt;
        }

        if (!actionExecution.performed) {
          await appendPlannerOutcome(
            runtime.sessionId,
            "生成或发送期间出现了更新消息，本次回复没有继续发送。",
          );
          const hasPendingNewerMessages = runtime.pendingMessages.length > boundaryCount;
          if (!hasPendingNewerMessages) {
            this.reportPerformance(performance, {
              action_type:
                plannerResult.action.type === "sendSticker"
                  ? "send_sticker"
                  : plannerResult.action.type,
              outcome: "cancelled",
            });
            performance = undefined;
            return;
          }
          gateBypassReason = "stale_retry";
          continue;
        }

        failedActionAttempts = 0;
        runtime.consecutiveNoActionCount = 0;
        runtime.backoffLevel = 0;
        runtime.nextEligibleAt = 0;
        this.reportPerformance(performance, {
          action_type:
            plannerResult.action.type === "sendSticker"
              ? "send_sticker"
              : plannerResult.action.type,
          outcome:
            plannerResult.action.type === "reply"
              ? "replied"
              : plannerResult.action.type === "sendSticker"
                ? "sticker_sent"
                : "poked",
          ...(actionExecution.sentMessageCount > 0
            ? { complete_reply_duration_ms: Date.now() - performance.startedAt }
            : {}),
        });
        performance = undefined;
        await this.consumeBatch(runtime, batch);
        await appendPlannerOutcome(runtime.sessionId, actionExecution.outcome);
        if (actionExecution.complete) {
          await this.commitPlanChanges(runtime.sessionId, planChanges);
        }
        await compressPlannerContextIfNeeded(runtime.sessionId);
      }
    } finally {
      runtime.running = false;
    }
  }

  private async executeAction(input: {
    session: Session;
    runtime: PlannerReplyerConversationRuntime;
    batch: StoredSatoriGroupMessage[];
    result: PlannerReplyerResult;
    taskVersion: number;
  }): Promise<ChatActionExecution> {
    const { action } = input.result;
    const sourceMessage = input.batch.at(-1)!;
    const recentMessages = chatManager.groupSession.getMessages(input.runtime.sessionId);
    const execution: ChatActionExecution = {
      performed: false,
      complete: false,
      outcome: "",
      replyerDurationMs: 0,
      stickerSelectorDurationMs: 0,
      splitDurationMs: 0,
      segmentDelayDurationMs: 0,
      platformSendDurationMs: 0,
      sentMessageCount: 0,
    };
    if (input.taskVersion !== input.runtime.replyTaskVersion) {
      return execution;
    }

    if (action.type === "poke") {
      const pokeStartedAt = Date.now();
      await sendChatPoke({
        session: input.session,
        targetMessageId: action.targetMessageId,
        recentMessages,
      });
      execution.performed = true;
      execution.complete = true;
      execution.outcome = "已经按判断戳了目标群友。";
      execution.platformSendDurationMs = Date.now() - pokeStartedAt;
      return execution;
    }

    const controller = new AbortController();
    input.runtime.replyController = controller;

    try {
      if (action.type === "sendSticker") {
        const stickerSelectorStartedAt = Date.now();
        const stickerKey = await selectChatSticker({
          recentMessages,
          intention: input.result.internalNote || "用一个表情包完成当前反应",
          abortSignal: controller.signal,
        });
        execution.stickerSelectorDurationMs = Date.now() - stickerSelectorStartedAt;
        if (input.taskVersion !== input.runtime.replyTaskVersion) {
          return execution;
        }
        const sendResult = await sendChatSegments({
          session: input.session,
          sourceMessage,
          textSegments: [],
          stickerKey,
          abortSignal: controller.signal,
        });
        execution.performed = sendResult.sentCount > 0;
        execution.complete = sendResult.complete;
        execution.outcome = `已经发送表情包 ${stickerKey}。`;
        execution.segmentDelayDurationMs = sendResult.segmentDelayDurationMs;
        execution.platformSendDurationMs = sendResult.platformSendDurationMs;
        execution.sentMessageCount = sendResult.sentCount;
        execution.firstSendCompletedAt = sendResult.firstSendCompletedAt;
        return execution;
      }

      if (action.type !== "reply") {
        return execution;
      }

      if (!recentMessages.some((message) => message.messageId === action.targetMessageId)) {
        throw new Error(`找不到回复目标消息：${action.targetMessageId}`);
      }

      const replyerStartedAt = Date.now();
      const replyText = await generateChatReply({
        recentMessages,
        targetMessageId: action.targetMessageId,
        intention: action.intention,
        expressionDirection: action.expressionDirection,
        abortSignal: controller.signal,
      });
      execution.replyerDurationMs = Date.now() - replyerStartedAt;
      if (!replyText || input.taskVersion !== input.runtime.replyTaskVersion) {
        return execution;
      }
      const splitStartedAt = Date.now();
      const textSegments = splitChatReply(replyText);
      execution.splitDurationMs = Date.now() - splitStartedAt;
      let stickerKey: string | undefined;
      if (action.stickerIntent) {
        const stickerSelectorStartedAt = Date.now();
        stickerKey = await selectChatSticker({
          recentMessages,
          intention: action.stickerIntent,
          expressionDirection: action.expressionDirection,
          replyText,
          abortSignal: controller.signal,
        });
        execution.stickerSelectorDurationMs = Date.now() - stickerSelectorStartedAt;
      }
      if (input.taskVersion !== input.runtime.replyTaskVersion) {
        return execution;
      }

      const sendResult = await sendChatSegments({
        session: input.session,
        sourceMessage,
        textSegments,
        stickerKey,
        quoteMessageId: action.setQuote ? action.targetMessageId : undefined,
        abortSignal: controller.signal,
      });
      execution.performed = sendResult.sentCount > 0;
      execution.complete = sendResult.complete;
      execution.outcome = `实际发送了 ${sendResult.sentCount} 条消息，${action.setQuote ? "第一条引用了目标消息，" : ""}文字内容：${replyText}`;
      execution.segmentDelayDurationMs = sendResult.segmentDelayDurationMs;
      execution.platformSendDurationMs = sendResult.platformSendDurationMs;
      execution.sentMessageCount = sendResult.sentCount;
      execution.firstSendCompletedAt = sendResult.firstSendCompletedAt;
      return execution;
    } finally {
      if (input.runtime.replyController === controller) {
        input.runtime.replyController = undefined;
      }
    }
  }

  private reportPerformance(
    performance: ChatReplyPerformance,
    result: {
      action_type: "reply" | "send_sticker" | "poke" | "wait" | "none" | "unknown";
      outcome: "replied" | "sticker_sent" | "poked" | "silent" | "cancelled" | "failed";
      failure_stage?: "planner" | "action";
      complete_reply_duration_ms?: number;
    },
  ): void {
    void reportAnalyticsEvent({
      event_name: "chat_reply_performance",
      event_data: {
        strategy: performance.strategy,
        platform: performance.platform,
        trigger_type: performance.trigger_type,
        planner_duration_ms: performance.planner_duration_ms,
        replyer_duration_ms: performance.replyer_duration_ms,
        wait_duration_ms: performance.wait_duration_ms,
        sticker_selector_duration_ms: performance.sticker_selector_duration_ms,
        split_duration_ms: performance.split_duration_ms,
        segment_delay_duration_ms: performance.segment_delay_duration_ms,
        platform_send_duration_ms: performance.platform_send_duration_ms,
        planner_call_count: performance.planner_call_count,
        tool_call_count: performance.tool_call_count,
        batch_message_count: performance.batch_message_count,
        new_message_count: performance.new_message_count,
        sent_message_count: performance.sent_message_count,
        ...result,
        total_duration_ms: Date.now() - performance.startedAt,
        ...(performance.first_reply_duration_ms === undefined
          ? {}
          : { first_reply_duration_ms: performance.first_reply_duration_ms }),
      },
    }).catch((error) => {
      logger.error("[message.analytics] 聊天性能埋点写入失败", { error });
    });
  }

  private async consumeBatch(
    runtime: PlannerReplyerConversationRuntime,
    batch: StoredSatoriGroupMessage[],
  ): Promise<void> {
    runtime.pendingMessages.splice(0, batch.length);
    await markPlannerMessagesProcessed(runtime.sessionId, batch.at(-1)!.messageId);
  }

  private async commitPlanChanges(
    sessionId: string,
    planChanges: PlannerReplyerResult["planChanges"],
  ): Promise<void> {
    if (!planChanges.length) {
      return;
    }

    const { summary, historyJson } = chatManager.groupSession.getHistoryJson(sessionId);
    await reviewAndApplyChatPlanChanges({
      planChanges,
      summary,
      historyJson,
    });
  }

  private getRuntime(sessionId: string): PlannerReplyerConversationRuntime {
    const existing = this.runtimeBySessionId.get(sessionId);
    if (existing) {
      return existing;
    }

    const runtime: PlannerReplyerConversationRuntime = {
      sessionId,
      pendingMessages: [],
      running: false,
      forceTrigger: false,
      replyTaskVersion: 0,
      consecutiveNoActionCount: 0,
      backoffLevel: 0,
      nextEligibleAt: 0,
      consecutiveWaitCount: 0,
    };
    this.runtimeBySessionId.set(sessionId, runtime);
    return runtime;
  }
}

export const plannerReplyerGroupChatManager = new PlannerReplyerGroupChatManager();

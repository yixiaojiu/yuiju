import { getPromptCustomizationOverrides } from "@yuiju/utils/db/operations/prompt-customization";
import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getFlashModel } from "@yuiju/utils/llm/models";
import {
  diarySearchTool,
  semanticDiarySearchTool,
  todayEventSearchTool,
} from "@yuiju/utils/llm/tools/memory-search";
import { createCollectedChatPlanChangesProposalTool } from "@yuiju/utils/llm/tools/propose-plan-changes";
import { queryAvailableInventoryItems } from "@yuiju/utils/llm/tools/query-available-inventory-items";
import { queryStateTool } from "@yuiju/utils/llm/tools/query-state";
import { buildChatPlannerSystemPrompt } from "@yuiju/utils/prompt/message";
import { getPromptCustomizationContent } from "@yuiju/utils/prompt/prompt-customization";
import { initCharacterStateData } from "@yuiju/utils/redis/state/character";
import { getTimeWithWeekday } from "@yuiju/utils/time";
import { generateText, hasToolCall, type ModelMessage, stepCountIs, tool } from "ai";
import dayjs from "dayjs";
import { z } from "zod";
import { logger } from "@/utils/logger";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";
import { buildPersonProfileContext } from "./person-profile-context";
import { buildChatPlannerHistory, getChatPlannerSession } from "./planner-session";
import type { PlannerReplyerChatAction, PlannerReplyerResult } from "./types";

const MAX_PLANNER_STEPS = 8;

export async function runChatPlanner(input: {
  sessionId: string;
  pendingMessages: StoredSatoriGroupMessage[];
  recentMessages: readonly StoredSatoriGroupMessage[];
  waitResult?: string;
  canProposePlanChanges: boolean;
}): Promise<PlannerReplyerResult> {
  const [plannerSession, characterState, overrides, personProfileContext] = await Promise.all([
    getChatPlannerSession(input.sessionId),
    initCharacterStateData(),
    getPromptCustomizationOverrides(["character", "world", "chatBehavior"]),
    buildPersonProfileContext(input.pendingMessages),
  ]);
  const historyJson = JSON.stringify(
    input.recentMessages.map((message) => ({
      messageId: message.messageId,
      speakerId: message.sender.id,
      speaker: message.sender.displayName,
      time: getTimeWithWeekday(dayjs(message.timestamp)),
      content: message.content,
    })),
    null,
    2,
  );
  const batchJson = JSON.stringify(
    input.pendingMessages.map((message) => ({
      messageId: message.messageId,
      speakerId: message.sender.id,
      speaker: message.sender.displayName,
      content: message.content,
    })),
    null,
    2,
  );
  const currentInput = [
    `【当前时间】\n${getTimeWithWeekday(dayjs())}`,
    `【当前状态】\n${JSON.stringify(characterState, null, 2)}`,
    `【最近 20 条真实群聊】\n${historyJson}`,
    `【本轮尚未判断的消息】\n${batchJson}`,
    input.waitResult ? `【等待结果】\n${input.waitResult}` : "",
    personProfileContext,
    "请延续此前的主观位置，判断此刻最自然的一个行动。没有自然参与点时直接结束。",
  ]
    .filter(Boolean)
    .join("\n\n");
  const persistedInput: ModelMessage = {
    role: "user",
    content: [
      `【本轮真实消息】\n${batchJson}`,
      input.waitResult ? `【等待结果】\n${input.waitResult}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  let selectedAction: PlannerReplyerChatAction | undefined;
  const planChanges: PlannerReplyerResult["planChanges"] = [];
  const selectAction = (action: PlannerReplyerChatAction) => {
    if (selectedAction) {
      return { status: "rejected", message: "本轮已经选择了一个社交行动。" };
    }
    selectedAction = action;
    return { status: "selected", message: "行动已记录，本轮判断结束。" };
  };
  const tools = {
    reply: tool({
      description: "确定现在要发送文字回复，只提供回复目标、单一意图和表达方向。",
      inputSchema: z.object({
        targetMessageId: z.string().min(1).describe("主要承接的真实消息 ID"),
        set_quote: z.boolean().describe("第一条文字消息是否引用目标消息"),
        intention: z.string().min(1).describe("这一刻真正想表达的一个重点"),
        expressionDirection: z.string().min(1).describe("态度、亲疏、力度、认真程度和消息粒度"),
        stickerIntent: z.string().min(1).optional().describe("文字后附带表情包的反应意图"),
      }),
      execute: async (action) =>
        selectAction({
          type: "reply",
          targetMessageId: action.targetMessageId,
          setQuote: action.set_quote,
          intention: action.intention,
          expressionDirection: action.expressionDirection,
          stickerIntent: action.stickerIntent,
        }),
    }),
    sendSticker: tool({
      description: "只发送一个表情包完成当前反应，不生成文字。",
      inputSchema: z.object({}),
      execute: async () => selectAction({ type: "sendSticker" }),
    }),
    poke: tool({
      description: "戳一下某条真实消息的发送者，作为独立社交回应。",
      inputSchema: z.object({
        targetMessageId: z.string().min(1).describe("目标人物发送的真实消息 ID"),
      }),
      execute: async ({ targetMessageId }) => selectAction({ type: "poke", targetMessageId }),
    }),
    wait: tool({
      description: "聊天仍在发展，现在接话容易抢拍时，等待一段时间后继续同一轮判断。",
      inputSchema: z.object({
        seconds: z.number().int().min(1).max(300).describe("等待秒数"),
      }),
      execute: async ({ seconds }) => selectAction({ type: "wait", seconds }),
    }),
    diarySearch: diarySearchTool,
    semanticDiarySearch: semanticDiarySearchTool,
    todayEventSearch: todayEventSearchTool,
    queryState: queryStateTool,
    queryAvailableInventoryItems,
    proposePlanChanges: createCollectedChatPlanChangesProposalTool({
      canCollect: input.canProposePlanChanges,
      collect: (changes) => planChanges.push(...changes),
    }),
  };

  const startedAt = Date.now();
  const result = await generateText({
    model: getFlashModel(),
    instructions: buildChatPlannerSystemPrompt({
      characterPrompt: getPromptCustomizationContent("character", overrides),
      worldPrompt: getPromptCustomizationContent("world", overrides),
      behaviorPrompt: getPromptCustomizationContent("chatBehavior", overrides),
    }),
    messages: [...buildChatPlannerHistory(plannerSession), { role: "user", content: currentInput }],
    tools,
    stopWhen: [
      stepCountIs(MAX_PLANNER_STEPS),
      hasToolCall("reply"),
      hasToolCall("sendSticker"),
      hasToolCall("poke"),
      hasToolCall("wait"),
    ],
    providerOptions: { flash: { enable_thinking: false } },
    telemetry: getLangfuseTelemetry(),
  });
  const maxInputTokens = Math.max(0, ...result.steps.map((step) => step.usage.inputTokens ?? 0));
  const toolCallCount = result.steps.reduce((count, step) => count + step.toolCalls.length, 0);

  logger.info("[message.planner-replyer.planner] Planner 调用完成", {
    sessionId: input.sessionId,
    durationMs: Date.now() - startedAt,
    inputTokens: maxInputTokens,
    toolCallCount,
    action: selectedAction?.type ?? "none",
    pendingCount: input.pendingMessages.length,
  });

  return {
    action: selectedAction ?? { type: "none" },
    planChanges,
    turnMessages: [persistedInput, ...result.responseMessages],
    maxInputTokens,
    toolCallCount,
    internalNote: result.text.trim(),
  };
}

import { getYuijuConfig } from "@yuiju/utils/config/config";
import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { chatPlannerCompressionPrompt } from "@yuiju/utils/prompt/message";
import { saveChatPlannerSession } from "@yuiju/utils/redis/chat-planner-session";
import { generateText } from "ai";
import { logger } from "@/utils/logger";
import { getChatPlannerSession } from "./planner-session";

const RETAINED_COMPLETE_TURNS = 3;
const COMPRESSION_RATIO = 0.7;
const COMPRESSION_MAX_OUTPUT_TOKENS = 4096;

export async function compressPlannerContextIfNeeded(sessionId: string): Promise<void> {
  const session = await getChatPlannerSession(sessionId);
  const latestInputTokens = session.turns.at(-1)?.maxInputTokens ?? 0;
  const contextWindowTokens = Math.min(
    ...getYuijuConfig().llm.models.flash.map((source) => source.context_window_tokens ?? 128_000),
  );
  const thresholdTokens = Math.floor(contextWindowTokens * COMPRESSION_RATIO);
  const compressibleTurns = session.turns.slice(0, -RETAINED_COMPLETE_TURNS);
  if (latestInputTokens < thresholdTokens || !compressibleTurns.length) {
    return;
  }

  const result = await generateText({
    model: getFlashModel(),
    instructions: chatPlannerCompressionPrompt,
    prompt: [
      `【上一份连续性备忘】\n${session.continuityMemo || "无"}`,
      `【本次移出原文窗口的 Planner 轮次】\n${JSON.stringify(compressibleTurns, null, 2)}`,
    ].join("\n\n"),
    maxOutputTokens: COMPRESSION_MAX_OUTPUT_TOKENS,
    providerOptions: { flash: { enable_thinking: false } },
    telemetry: getLangfuseTelemetry(),
  }).catch((error) => {
    logger.error("[message.planner-replyer.compression] Planner 上下文压缩失败", {
      sessionId,
      error,
    });
    return null;
  });
  if (!result) {
    return;
  }
  const continuityMemo = result.text.trim();
  if (!continuityMemo) {
    return;
  }

  session.continuityMemo = continuityMemo;
  session.turns = session.turns.slice(-RETAINED_COMPLETE_TURNS);
  session.updatedAt = Date.now();
  await saveChatPlannerSession(sessionId, session);

  logger.info("[message.planner-replyer.compression] Planner 上下文压缩完成", {
    sessionId,
    thresholdTokens,
    inputTokens: latestInputTokens,
    compressedTurnCount: compressibleTurns.length,
    retainedTurnCount: session.turns.length,
  });
}

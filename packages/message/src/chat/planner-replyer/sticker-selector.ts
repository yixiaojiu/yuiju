import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getFlashModel } from "@yuiju/utils/llm/models";
import { chatStickerSelectorPrompt } from "@yuiju/utils/prompt/message";
import { generateText } from "ai";
import { stickerState } from "@/state/sticker";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export async function selectChatSticker(input: {
  recentMessages: readonly StoredSatoriGroupMessage[];
  intention: string;
  expressionDirection?: string;
  replyText?: string;
  abortSignal: AbortSignal;
}): Promise<string> {
  const candidates = stickerState.list();
  if (!candidates.length) {
    throw new Error("Planner-Replyer 策略没有可用表情包");
  }

  const result = await generateText({
    model: getFlashModel(),
    instructions: chatStickerSelectorPrompt,
    prompt: [
      `【最近 5 条真实群聊】\n${JSON.stringify(
        input.recentMessages.slice(-5).map((message) => ({
          speaker: message.sender.displayName,
          content: message.content,
        })),
        null,
        2,
      )}`,
      `【本次反应意图】\n${input.intention}`,
      input.expressionDirection ? `【表达方向】\n${input.expressionDirection}` : "",
      input.replyText ? `【已经生成的文字】\n${input.replyText}` : "",
      `【候选表情包】\n${candidates
        .map((sticker) => `${sticker.key}: ${sticker.description}`)
        .join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    abortSignal: input.abortSignal,
    providerOptions: { flash: { enable_thinking: false } },
    telemetry: getLangfuseTelemetry(),
  });

  const key = result.text.trim();
  if (!candidates.some((candidate) => candidate.key === key)) {
    throw new Error(`表情包选择器返回了无效 key：${key}`);
  }
  return key;
}

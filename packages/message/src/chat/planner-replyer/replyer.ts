import { getPromptCustomizationOverrides } from "@yuiju/utils/db/operations/prompt-customization";
import { getLangfuseTelemetry } from "@yuiju/utils/llm/langfuse-telemetry";
import { getChatModel } from "@yuiju/utils/llm/models";
import { buildChatReplyerSystemPrompt } from "@yuiju/utils/prompt/message";
import { getPromptCustomizationContent } from "@yuiju/utils/prompt/prompt-customization";
import { initCharacterStateData } from "@yuiju/utils/redis/state/character";
import { generateText } from "ai";
import type { StoredSatoriGroupMessage } from "@/utils/message/types";

export async function generateChatReply(input: {
  recentMessages: readonly StoredSatoriGroupMessage[];
  targetMessageId: string;
  intention: string;
  expressionDirection: string;
  abortSignal: AbortSignal;
}): Promise<string> {
  const [overrides, characterState] = await Promise.all([
    getPromptCustomizationOverrides(["character", "world", "chatReply"]),
    initCharacterStateData(),
  ]);
  const historyJson = JSON.stringify(
    input.recentMessages.map((message) => ({
      messageId: message.messageId,
      speaker: message.sender.displayName,
      content: message.content,
    })),
    null,
    2,
  );

  const result = await generateText({
    model: getChatModel(),
    instructions: buildChatReplyerSystemPrompt({
      characterPrompt: getPromptCustomizationContent("character", overrides),
      worldPrompt: getPromptCustomizationContent("world", overrides),
      replyPrompt: getPromptCustomizationContent("chatReply", overrides),
    }),
    prompt: `
【当前状态】
${JSON.stringify(characterState, null, 2)}

【最近真实群聊】
${historyJson}

【回复目标】
${input.targetMessageId}

【唯一表达意图】
${input.intention}

【表达方向】
${input.expressionDirection}

直接输出最终会发送的普通文本，不要解释。
`.trim(),
    abortSignal: input.abortSignal,
    telemetry: getLangfuseTelemetry(),
  });

  return result.text.trim();
}

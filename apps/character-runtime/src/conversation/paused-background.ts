import { flashModel } from "@yuiju/shared/llm/models";
import { generateText } from "ai";
import { type ConversationMessage, renderMessage } from "./message";

/** 只生成摘要；暂停状态和持久化仍由会话管理。 */
export async function summarizePausedBackground(
  instructions: string,
  previousSummary: string,
  messages: ConversationMessage[],
  timezone: string,
  botIds: readonly string[],
): Promise<string> {
  const result = await generateText({
    model: flashModel,
    instructions,
    maxRetries: 0,
    prompt: `已有背景：\n${previousSummary}\n\n后续交流：\n${messages.map((message) => renderMessage(message, timezone, botIds)).join("\n")}`,
  });
  if (result.finishReason !== "stop" || !result.text.trim()) {
    throw new Error("暂停聊天摘要未正常生成，保留原文及暂停状态");
  }
  return result.text.trim();
}

import { getMultimodalModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type UserContent } from "ai";
import type { z } from "zod";
import type { ConversationScope } from "../message";
import type { understandMediaSchema } from "./definitions";

/** 下载并理解所选媒体；失败返回阶段与原因，由 Planner 决定后续处理，不中断工具循环。 */
export async function understandMedia(
  { media, instruction }: z.infer<typeof understandMediaSchema>,
  scope: ConversationScope,
  abortSignal?: AbortSignal,
) {
  const startedAt = Date.now();
  let stage = "准备提示词";
  try {
    const instructions = await renderPrompt("conversation.multimodal");
    const content: UserContent = [];
    if (instruction !== undefined) {
      content.push({ type: "text", text: instruction });
    }

    for (const [index, item] of media.entries()) {
      stage = `下载第 ${index + 1} 个媒体（${item.type}）`;
      const response = await fetch(item.url, { signal: abortSignal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      content.push(
        { type: "text", text: `媒体 ${index + 1}（${item.type}）` },
        {
          type: "file",
          data: new Uint8Array(await response.arrayBuffer()),
          // SDK 根据文件字节识别具体 MIME；不凭 URL 后缀猜测格式，也不转码。
          mediaType: item.type,
        },
      );
    }

    stage = "调用多模态模型";
    const result = await generateText({
      model: getMultimodalModel([...new Set(media.map((item) => item.type))]),
      instructions,
      messages: [{ role: "user", content }],
      maxRetries: 0,
      abortSignal,
    });
    if (result.finishReason !== "stop" || !result.text.trim()) {
      throw new Error(`未正常生成理解结果：${result.finishReason}`);
    }

    return result.text.trim();
  } catch (error) {
    logger.error("聊天媒体理解失败", {
      stage: "planner.multimodal",
      failedAt: stage,
      mediaCount: media.length,
      durationMs: Date.now() - startedAt,
      error,
    });
    // 返回明确的失败事实，完整异常留在日志；不标记整轮失败或由程序重跑批次。
    return `媒体理解失败：${stage}失败，${error instanceof Error ? error.message : String(error)}`;
  }
}

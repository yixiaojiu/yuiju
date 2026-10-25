import type { LanguageModelUsage, ModelMessage } from "ai";

/** 同一次请求的未校准估算与实际用量；不包含输出、工具执行结果或后续到达的消息。 */
export type InputTokenUsage = { inputEstimate: number; inputTokens: number };

export function measureInputBytes(messages: ModelMessage[], toolDescription = ""): number {
  return Buffer.byteLength(JSON.stringify(messages) + toolDescription, "utf8");
}

/** 缺失用量时清除旧基准；SDK 可能把供应商未提供的输入量转换为 0。 */
export function readInputTokenUsage(
  inputEstimate: number,
  usage: LanguageModelUsage,
): InputTokenUsage | undefined {
  if (usage.inputTokens === undefined || usage.inputTokens <= 0) {
    return undefined;
  }
  return { inputEstimate, inputTokens: usage.inputTokens };
}

/** 文本按实际用量与基础估算的比率校准；图片始终按每张 1024 token 计，不参与缩放。 */
export function estimateInputTokens(
  messages: ModelMessage[],
  toolDescription = "",
  usage?: InputTokenUsage,
): number {
  let imageTokens = 0;
  const textMessages = messages.map((message) => {
    if (typeof message.content === "string") {
      return message;
    }
    return {
      ...message,
      content: message.content
        .filter((part) => {
          if (
            part.type === "image" ||
            ((part.type === "file" || part.type === "reasoning-file") &&
              (part.mediaType === "image" || part.mediaType.startsWith("image/")))
          ) {
            imageTokens += 1024;
            return false;
          }
          return true;
        })
        .map((part) => {
          if (part.type !== "tool-result" || part.output.type !== "content") {
            return part;
          }
          return {
            ...part,
            output: {
              ...part.output,
              value: part.output.value.filter((item) => {
                if (
                  item.type === "file" &&
                  (item.mediaType === "image" || item.mediaType.startsWith("image/"))
                ) {
                  imageTokens += 1024;
                  return false;
                }
                return true;
              }),
            },
          };
        }),
    };
  });
  const textBytes = Buffer.byteLength(JSON.stringify(textMessages) + toolDescription, "utf8");
  return Math.ceil(
    (usage ? (textBytes * usage.inputTokens) / usage.inputEstimate : textBytes) + imageTokens,
  );
}

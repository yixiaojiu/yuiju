import type { LanguageModelUsage, ModelMessage } from "ai";

/** 同一次请求的输入大小与实际用量；不包含输出、工具执行结果或后续到达的消息。 */
export type InputTokenUsage = { inputBytes: number; inputTokens: number };

export function measureInputBytes(messages: ModelMessage[], toolDescription = ""): number {
  return Buffer.byteLength(JSON.stringify(messages) + toolDescription, "utf8");
}

/** 缺失用量时清除旧基准；SDK 可能把供应商未提供的输入量转换为 0。 */
export function readInputTokenUsage(
  inputBytes: number,
  usage: LanguageModelUsage,
): InputTokenUsage | undefined {
  if (usage.inputTokens === undefined || usage.inputTokens <= 0) {
    return undefined;
  }
  return { inputBytes, inputTokens: usage.inputTokens };
}

/** 用实际输入量校准字节/token 比率，只估算大小变化；无有效基准时按字节数兜底。 */
export function estimateInputTokens(
  messages: ModelMessage[],
  toolDescription = "",
  usage?: InputTokenUsage,
): number {
  const bytes = measureInputBytes(messages, toolDescription);
  if (!usage) {
    return bytes;
  }
  const deltaBytes = bytes - usage.inputBytes;
  return Math.ceil(usage.inputTokens + (deltaBytes * usage.inputTokens) / usage.inputBytes);
}

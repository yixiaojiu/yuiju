import { strongModel } from "@yuiju/shared/llm/models";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type ModelMessage, type ToolSet } from "ai";

/** 每个单位都是一次输入或一个完整模型步骤；工具调用和结果始终一起保留。 */
export type AgentContextState = {
  summary: string;
  units: ModelMessage[][];
};

/** 主 loop 请求前同步压缩；本轮在内存中使用新摘要，结束时统一持久化。 */
export async function prepareAgentContext(
  state: AgentContextState,
  instructions: string,
  tools: ToolSet,
  toolDescription: string,
  windowTokens: number,
  signal: AbortSignal,
): Promise<AgentContextState> {
  // 与聊天一致，用 UTF-8 字节作保守估算；不是精确 tokenizer，也不扣输出预留。
  const estimate = (context: AgentContextState) =>
    Buffer.byteLength(
      JSON.stringify(agentMessages(context, instructions)) + toolDescription,
      "utf8",
    );
  if (estimate(state) < windowTokens * 0.85) {
    return state;
  }
  const context = structuredClone(state);
  while (estimate(context) >= windowTokens * 0.85) {
    // 优先留最近四个完整单位；容量不足时逐步缩小保留范围，至少留下最新单位。
    const keep = Math.min(4, context.units.length - 1);
    if (keep < 1) {
      throw new Error("主 loop 最新完整交互已超过压缩阈值，不能截断工具调用继续请求");
    }
    const prefix = context.units.slice(0, -keep);
    const compressionPrompt = await renderPrompt("agentLoop.compression");
    while (
      prefix.length &&
      estimate({ summary: context.summary, units: prefix }) +
        Buffer.byteLength(compressionPrompt, "utf8") >=
        windowTokens
    ) {
      prefix.pop();
    }
    if (!prefix.length) {
      throw new Error("主 loop 没有能够放入压缩请求的完整旧交互");
    }
    const result = await generateText({
      model: strongModel,
      messages: [
        ...agentMessages({ summary: context.summary, units: prefix }, instructions),
        { role: "user", content: compressionPrompt },
      ],
      allowSystemInMessages: true,
      tools,
      toolChoice: "none",
      maxRetries: 0,
      abortSignal: signal,
    });
    if (result.finishReason !== "stop" || !result.text.trim()) {
      throw new Error("主 loop 压缩未正常生成摘要，保留原上下文");
    }
    const compressed = { summary: result.text.trim(), units: context.units.slice(prefix.length) };
    if (estimate(compressed) >= estimate(context)) {
      throw new Error("主 loop 摘要没有缩短上下文，保留原文");
    }
    context.summary = compressed.summary;
    context.units = compressed.units;
  }
  return context;
}

export function agentMessages(context: AgentContextState, instructions: string): ModelMessage[] {
  return [
    { role: "system", content: instructions },
    ...(context.summary
      ? [{ role: "user" as const, content: `此前生活与决策的摘要：\n${context.summary}` }]
      : []),
    ...context.units.flat(),
  ];
}

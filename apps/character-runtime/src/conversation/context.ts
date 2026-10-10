import { reportAnalyticsEvent } from "@yuiju/shared/analytics/report-event";
import {
  estimateInputTokens,
  type InputTokenUsage,
  measureInputBytes,
} from "@yuiju/shared/llm/context-usage";
import { logger } from "@yuiju/shared/logger/logger";
import { generateText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ConversationScope } from "./message";

/** coveredThrough 对应 Planner 的交互序号或 Replyer 的群消息序号。 */
export type ContextSummary = { text: string; coveredThrough: number };
/** 最小压缩单位；一次模型响应中的工具调用与全部结果必须放在同一单位内。 */
export type ContextUnit = { sequence: number; messages: ModelMessage[] };

type ContextOptions = {
  scope: ConversationScope;
  stage: "planner" | "replyer";
  system: string;
  compressionPrompt: string;
  model: LanguageModel;
  windowTokens: number;
  tools?: ToolSet;
  toolDescription?: string;
};

/** 管理一个模型的摘要与后台压缩；原始历史由 Planner / Replyer 的调用方持有。 */
export class ConversationContext {
  /** 由正常生成的单步结果更新；只在内存保留，后台压缩不写入此基准。 */
  inputUsage: InputTokenUsage | undefined;
  private task: Promise<void> | undefined;
  /** 后台任务只产出摘要，下一次请求前再替换其覆盖的历史前缀。 */
  private completed: ContextSummary | undefined;
  private currentSummary: Readonly<ContextSummary>;

  constructor(
    private readonly options: ContextOptions,
    summary: Readonly<ContextSummary>,
  ) {
    this.currentSummary = summary;
  }

  get summary(): Readonly<ContextSummary> {
    return this.currentSummary;
  }

  /** 暂停聊天整理后替换背景；调用方先等待旧压缩结束，再提交覆盖边界。 */
  replaceSummary(summary: ContextSummary): void {
    this.currentSummary = summary;
    this.completed = undefined;
    this.inputUsage = undefined;
  }

  applyCompression() {
    if (this.completed) {
      this.currentSummary = this.completed;
      this.completed = undefined;
      this.inputUsage = undefined;
    }
  }

  /** 达到等待阈值时先压缩并重新组装：Planner 为 85%，Replyer 为 70%。 */
  async prepare(units: ContextUnit[], current: ModelMessage[]): Promise<ModelMessage[]> {
    const blockingRatio = this.options.stage === "replyer" ? 0.7 : 0.85;
    this.applyCompression();
    let messages = this.maintain(units, current);
    while (
      estimateInputTokens(messages, this.options.toolDescription, this.inputUsage) >=
      this.options.windowTokens * blockingRatio
    ) {
      if (!this.task) {
        throw new Error(
          `${this.options.stage} 上下文达到 ${blockingRatio * 100}%，没有可压缩的旧交互`,
        );
      }

      await this.task;
      if (!this.completed) {
        throw new Error(
          `${this.options.stage} 上下文达到 ${blockingRatio * 100}%，压缩失败，暂停生成`,
        );
      }
      this.applyCompression();
      // 上一次快照之后可能又新增了交互；仍达阈值时继续压缩尚未覆盖的旧内容。
      messages = this.maintain(units, current);
    }
    return messages;
  }

  // 旁听时也维护摘要，避免长期不回复的群积累无限的 Replyer 原文。
  maintain(units: ContextUnit[], current: ModelMessage[] = []): ModelMessage[] {
    // 稳定前缀后追加未压缩历史与当前任务；摘要切换前不重写已有消息，便于前缀缓存命中。
    const history = units.filter((unit) => unit.sequence > this.currentSummary.coveredThrough);
    const prefix: ModelMessage[] = [{ role: "system", content: this.options.system }];
    if (this.currentSummary.text) {
      prefix.push({ role: "user", content: `此前上下文摘要：\n${this.currentSummary.text}` });
    }
    const messages = [...prefix, ...history.flatMap((unit) => unit.messages), ...current];

    // Replyer 每个 history 单位对应一条真实聊天消息，临时任务不参与计数。
    // 仍保留 70% 容量触发，避免不足 50 条的长消息使请求无法进入压缩流程。
    const contextTokens = estimateInputTokens(
      messages,
      this.options.toolDescription,
      this.inputUsage,
    );
    const messageCountReached = this.options.stage === "replyer" && history.length >= 50;
    const shouldCompress = messageCountReached || contextTokens >= this.options.windowTokens * 0.7;
    if (shouldCompress && !this.task && !this.completed && history.length > 1) {
      // Replyer 保留最近 10 条；积压超过 50 条时，也将其余旧消息一起整理。
      let keepFrom = Math.max(0, history.length - 10);
      if (this.options.stage === "planner") {
        // Planner 继续保留约 10% 窗口的完整交互，工具调用与结果不能拆开。
        keepFrom = history.length;
        let retainedEstimate = 0;
        do {
          keepFrom -= 1;
          retainedEstimate += estimateInputTokens(history[keepFrom].messages, "", this.inputUsage);
        } while (keepFrom > 0 && retainedEstimate < this.options.windowTokens * 0.1);
      }

      if (keepFrom > 0) {
        this.task = this.compress(
          structuredClone(prefix),
          structuredClone(history.slice(0, keepFrom)),
          contextTokens,
          messageCountReached ? "message_count" : "token_limit",
        ).finally(() => {
          this.task = undefined;
        });
      }
    }

    // 后台任务和当前请求均不能修改另一方持有的快照。
    return structuredClone(messages);
  }

  async stop() {
    await this.task;
    this.applyCompression();
  }

  private async compress(
    prefix: ModelMessage[],
    units: ContextUnit[],
    contextTokens: number,
    trigger: "message_count" | "token_limit",
  ) {
    const { stage, model, tools, toolDescription, windowTokens, compressionPrompt } = this.options;
    const startedAt = Date.now();
    // 正常生成可能同时更新用量；本次压缩始终使用启动时的计数基准。
    const inputUsage = this.inputUsage;
    try {
      const suffix: ModelMessage = { role: "user", content: compressionPrompt };

      // 压缩指令也占用窗口；超出时从尾部移除完整单位，未覆盖的原文仍由持有方保留。
      while (
        units.length &&
        estimateInputTokens(
          [...prefix, ...units.flatMap((unit) => unit.messages), suffix],
          toolDescription,
          inputUsage,
        ) > windowTokens
      ) {
        units.pop();
      }
      if (!units.length) {
        throw new Error("没有能放入压缩请求的完整历史单位");
      }

      // 只在真正发起压缩时计数；记录完整上下文占用，不使用裁剪后的压缩输入量。
      reportAnalyticsEvent({
        eventName: "agent.context_compression",
        eventData: {
          scene: stage,
          characterId: this.options.scope.characterId,
          channelId: this.options.scope.channelId,
          trigger,
          contextTokens,
          windowTokens,
          measurement: inputUsage ? "usage_calibrated" : "byte_fallback",
        },
      });

      // 保留原工具定义以复用请求前缀，但压缩请求不能执行工具。
      const result = await generateText({
        model,
        tools,
        toolChoice: "none",
        allowSystemInMessages: true,
        maxRetries: 0,
        messages: [...prefix, ...units.flatMap((unit) => unit.messages), suffix],
      });
      if (result.finishReason !== "stop" || !result.text.trim() || result.toolCalls.length) {
        throw new Error("压缩未正常输出摘要");
      }

      const text = result.text.trim();
      // 只接受确实缩短上下文的摘要，避免前台反复压缩却无法释放空间。
      if (
        measureInputBytes([{ role: "user", content: `此前上下文摘要：\n${text}` }]) >=
        measureInputBytes([...prefix.slice(1), ...units.flatMap((unit) => unit.messages)])
      ) {
        throw new Error("摘要未缩短上下文，保留原历史");
      }
      this.completed = { text, coveredThrough: units.at(-1)!.sequence };
    } catch (error) {
      // 原上下文保留，后续有输入时再尝试，不启动后台重试循环。
      logger.error("聊天上下文压缩失败", {
        stage: `${stage}.compression`,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  }
}

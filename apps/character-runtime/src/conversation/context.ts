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

// UTF-8 字节数只用于偏保守的调度，不是精确的模型 tokenizer。
export function estimateInput(messages: ModelMessage[], toolDescription = "") {
  return Buffer.byteLength(JSON.stringify(messages) + toolDescription, "utf8");
}

/** 管理一个模型的摘要与后台压缩；原始历史由 Planner / Replyer 的调用方持有。 */
export class ConversationContext {
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
  }

  applyCompression() {
    if (this.completed) {
      this.currentSummary = this.completed;
      this.completed = undefined;
    }
  }

  /** 达到等待阈值时先压缩并重新组装：Planner 为 85%，Replyer 为 70%。 */
  async prepare(units: ContextUnit[], current: ModelMessage[]): Promise<ModelMessage[]> {
    const blockingRatio = this.options.stage === "replyer" ? 0.7 : 0.85;
    this.applyCompression();
    let messages = this.maintain(units, current);
    while (
      estimateInput(messages, this.options.toolDescription) >=
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

    // Replyer 在 50% 时提前整理真实聊天，Planner 在 70% 时启动；已有任务不重复启动。
    const backgroundRatio = this.options.stage === "replyer" ? 0.5 : 0.7;
    if (
      estimateInput(messages, this.options.toolDescription) >=
        this.options.windowTokens * backgroundRatio &&
      !this.task &&
      !this.completed &&
      history.length > 1
    ) {
      // 最近约 10% 窗口的原文继续保留，至少保留一个完整交互；这不是输出空间预留。
      let keepFrom = history.length;
      let retainedEstimate = 0;
      do {
        keepFrom -= 1;
        retainedEstimate += estimateInput(history[keepFrom].messages);
      } while (keepFrom > 0 && retainedEstimate < this.options.windowTokens * 0.1);

      if (keepFrom > 0) {
        this.task = this.compress(
          structuredClone(prefix),
          structuredClone(history.slice(0, keepFrom)),
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

  private async compress(prefix: ModelMessage[], units: ContextUnit[]) {
    const { scope, stage, model, tools, toolDescription, windowTokens, compressionPrompt } =
      this.options;
    const startedAt = Date.now();
    try {
      const suffix: ModelMessage = { role: "user", content: compressionPrompt };

      // 压缩指令也占用窗口；超出时从尾部移除完整单位，未覆盖的原文仍由持有方保留。
      while (
        units.length &&
        estimateInput(
          [...prefix, ...units.flatMap((unit) => unit.messages), suffix],
          toolDescription,
        ) > windowTokens
      ) {
        units.pop();
      }
      if (!units.length) {
        throw new Error("没有能放入压缩请求的完整历史单位");
      }

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
        estimateInput([{ role: "user", content: `此前上下文摘要：\n${text}` }]) >=
        estimateInput([...prefix.slice(1), ...units.flatMap((unit) => unit.messages)])
      ) {
        throw new Error("摘要未缩短上下文，保留原历史");
      }
      this.completed = { text, coveredThrough: units.at(-1)!.sequence };
      logger.info("聊天上下文压缩完成", {
        ...scope,
        stage: `${stage}.compression`,
        durationMs: Date.now() - startedAt,
        usage: result.usage,
      });
    } catch (error) {
      // 原上下文保留，后续有输入时再尝试，不启动后台重试循环。
      logger.error("聊天上下文压缩失败", {
        ...scope,
        stage: `${stage}.compression`,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  }
}

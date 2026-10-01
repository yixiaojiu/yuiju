import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { type ContextUnit, ConversationContext } from "./context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "./message";
import {
  type ConversationToolContext,
  createPlannerTools,
  plannerToolDescription,
  plannerTools,
} from "./tools";

/** 每群独立的工具循环；上下文只保留输入及 SDK 生成的模型消息、工具调用与结果。 */
export class Planner {
  private context!: ConversationContext;
  /** 初始化时从合并默认值后的项目配置读取，用于模型输入中的时间展示。 */
  private timezone!: string;
  /** 按完成顺序追加的输入和完整模型交互；工具执行结果属于对应交互，不额外追加。 */
  private history: ContextUnit[] = [];
  /** 上下文交互序号，与群消息序号、业务轮次分开计数。 */
  private sequence = 0;

  constructor(private readonly scope: ConversationScope) {}

  async initialize() {
    const config = await load_config();
    this.timezone = config.app!.timezone!;
    const windowTokens = config.llm?.models?.flash?.context_window_tokens;
    if (!windowTokens) {
      throw new Error("群聊需要配置 flash.context_window_tokens");
    }
    const [persona, rules, compressionPrompt] = await Promise.all([
      renderPrompt(`character.persona.${this.scope.characterId}`),
      renderPrompt("conversation.planner"),
      renderPrompt("conversation.plannerCompression"),
    ]);
    this.context = new ConversationContext({
      scope: this.scope,
      stage: "planner",
      system: `${persona}\n\n${rules}`,
      compressionPrompt,
      model: flashModel,
      windowTokens,
      tools: plannerTools,
      toolDescription: plannerToolDescription,
    });
  }

  get state() {
    return { history: this.history, summary: this.context.summary };
  }

  async run(
    messages: ConversationMessage[],
    execution: ConversationToolContext,
    waitedSeconds?: number,
  ): Promise<void> {
    const input: ModelMessage[] = [];
    if (waitedSeconds !== undefined) {
      input.push({
        role: "user",
        content: `等待结束，实际等待 ${waitedSeconds} 秒，继续此前判断。\n当前时间：${formatLlmDateTime(Date.now(), this.timezone)}`,
      });
    }
    input.push(
      ...messages.map(
        (message): ModelMessage => ({
          role: "user",
          content: renderMessage(message, this.timezone),
        }),
      ),
    );
    this.history.push({ sequence: ++this.sequence, messages: input });

    const startedAt = Date.now();
    const result = await generateText({
      model: flashModel,
      messages: input,
      reasoning: "none",
      allowSystemInMessages: true,
      tools: createPlannerTools(this.scope, this.timezone, execution),
      maxRetries: 0,
      stopWhen: [stepCountIs(20), () => execution.waitSeconds !== undefined],
      prepareStep: async () => {
        // 每一步都从已记录历史重建请求；压缩只改变上下文，不重放已执行工具。
        const messages = await this.context.prepare(this.history, []);
        this.history = this.history.filter(
          (unit) => unit.sequence > this.context.summary.coveredThrough,
        );
        return { messages };
      },
      onStepEnd: ({ response, content }) => {
        // SDK 在本步工具全部结束后提供该步消息；多工具调用与结果作为一个单位记录。
        this.history.push({ sequence: ++this.sequence, messages: response.messages });
        for (const output of content) {
          if (output.type === "tool-error") {
            execution.failed = true;
            logger.error("聊天工具调用失败", {
              ...this.scope,
              tool: output.toolName,
              error: output.error,
            });
          }
        }
      },
    });

    if (result.finishReason !== "stop" && result.finishReason !== "tool-calls") {
      throw new Error(`Planner 未完成：${result.finishReason}`);
    }
    if (execution.waitSeconds === undefined && result.finishReason !== "stop") {
      throw new Error("Planner 达到调用上限，尚未结束本轮");
    }
    logger.info("聊天工具循环结束", {
      ...this.scope,
      stage: "planner",
      durationMs: Date.now() - startedAt,
      usage: result.usage,
      sendAttempted: execution.sendAttempted,
      failed: execution.failed,
      waitSeconds: execution.waitSeconds,
    });
  }

  async stop() {
    await this.context.stop();
    this.history = this.history.filter(
      (unit) => unit.sequence > this.context.summary.coveredThrough,
    );
  }
}

import { load_config } from "@yuiju/shared/config/load";
import { formatLlmDateTime } from "@yuiju/shared/date/format";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { type ContextUnit, ConversationContext } from "./context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "./message";
import type { ConversationState } from "./storage";
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

  async initialize(state: ConversationState["planner"]) {
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
    this.history = state.history;
    this.sequence = Math.max(state.summary.coveredThrough, state.history.at(-1)?.sequence ?? 0);
    this.context = new ConversationContext(
      {
        scope: this.scope,
        stage: "planner",
        system: `${persona}\n\n${rules}`,
        compressionPrompt,
        model: flashModel,
        windowTokens,
        tools: plannerTools,
        toolDescription: plannerToolDescription,
      },
      state.summary,
    );
  }

  get state() {
    return { history: this.history, summary: this.context.summary };
  }

  /** 只供后续交流了解背景，不以恢复聊天为由触发补答。 */
  appendBackground(text: string): void {
    this.history.push({ sequence: ++this.sequence, messages: [{ role: "user", content: text }] });
  }

  /** 由会话在提交队列内追加，与 plannerInputThrough 一起保存。 */
  appendInput(messages: ConversationMessage[], waitedSeconds?: number): void {
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
    if (input.length) this.history.push({ sequence: ++this.sequence, messages: input });
  }

  async run(execution: ConversationToolContext, saveContext: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();
    this.appendBackground(`当前角色状态：\n${await execution.readCharacter()}`);
    await saveContext();
    // SDK 的 onStepEnd 会吞掉回调异常，必须在下一步请求前和最终返回时显式传播。
    let stepSaveError: Error | undefined;
    const result = await generateText({
      model: flashModel,
      messages: this.history.flatMap((unit) => unit.messages),
      reasoning: "none",
      allowSystemInMessages: true,
      tools: createPlannerTools(this.scope, this.timezone, execution),
      maxRetries: 0,
      stopWhen: [stepCountIs(20), () => execution.waitSeconds !== undefined],
      prepareStep: async () => {
        if (!execution.canParticipate()) {
          throw new Error("角色已暂停群聊，结束当前聊天思考");
        }
        if (stepSaveError) throw stepSaveError;
        // 每一步都从已记录历史重建请求；压缩只改变上下文，不重放已执行工具。
        const previousSummary = this.context.summary;
        try {
          return { messages: await this.context.prepare(this.history, []) };
        } finally {
          // prepare 可能已应用一份摘要，再因窗口仍不足而失败；已应用的状态也要成对保存。
          if (previousSummary !== this.context.summary) {
            this.history = this.history.filter(
              (unit) => unit.sequence > this.context.summary.coveredThrough,
            );
            await saveContext();
          }
        }
      },
      onStepEnd: async ({ response, content }) => {
        // SDK 在本步工具全部结束后提供该步消息；多工具调用与结果作为一个单位记录。
        this.history.push({ sequence: ++this.sequence, messages: response.messages });
        try {
          await saveContext();
        } catch (error) {
          stepSaveError = new Error("Planner 完整步骤保存失败", { cause: error });
        }
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

    if (stepSaveError) throw stepSaveError;
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

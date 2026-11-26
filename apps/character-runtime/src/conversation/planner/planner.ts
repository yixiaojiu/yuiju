import { reportAnalyticsEvent } from "@yuiju/shared/analytics/report-event";
import { load_config } from "@yuiju/shared/config/load";
import { estimateInputTokens, readInputTokenUsage } from "@yuiju/shared/llm/context-usage";
import { flashModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { formatLlmDateTime } from "@yuiju/shared/utils/date";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { z } from "zod";
import { type ContextUnit, ConversationContext } from "../context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "../message";
import type { PlannerState } from "../storage/redis";
import { type ConversationToolContext, createPlannerTools } from "./tools";

/** 角色级唯一聊天工具循环；跨群保持同一条仅追加上下文以保留前缀缓存。 */
export class Planner {
  private context!: ConversationContext;
  /** 初始化时从合并默认值后的项目配置读取，用于模型输入中的时间展示。 */
  private timezone!: string;
  /** 按完成顺序追加的输入和完整模型交互；工具执行结果属于对应交互，不额外追加。 */
  private history: ContextUnit[] = [];
  /** 上下文交互序号，与群消息序号、业务轮次分开计数。 */
  private sequence = 0;

  constructor(
    private readonly characterId: string,
    private readonly platform: ConversationScope["platform"],
    private readonly botIds: readonly string[],
  ) {}

  async initialize(state: PlannerState["planner"]) {
    const config = await load_config();
    this.timezone = config.app!.timezone!;
    const windowTokens = config.llm?.models?.flash?.context_window_tokens;
    if (!windowTokens) {
      throw new Error("群聊需要配置 flash.context_window_tokens");
    }
    const [persona, rules, characterPrompt, compressionPrompt] = await Promise.all([
      renderPrompt(`character.persona.${this.characterId}`),
      renderPrompt("conversation.planner"),
      renderPrompt(`conversation.planner.${this.characterId}`),
      renderPrompt("conversation.planner_compression"),
    ]);
    this.history = state.history;
    this.sequence = Math.max(state.summary.coveredThrough, state.history.at(-1)?.sequence ?? 0);
    this.context = new ConversationContext(
      {
        stage: "planner",
        scope: { characterId: this.characterId, platform: this.platform },
        system: `${persona}\n\n${rules}\n\n${characterPrompt}`,
        compressionPrompt,
        model: flashModel,
        windowTokens,
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

  /** 由会话在提交队列内追加，与当前焦点群的 plannerInputThrough 一起保存。 */
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
          content: renderMessage(message, this.timezone, this.botIds),
        }),
      ),
    );
    if (input.length) {
      this.history.push({ sequence: ++this.sequence, messages: input });
    }
  }

  async run(
    scope: ConversationScope,
    execution: ConversationToolContext,
    saveContext: () => Promise<void>,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      const tools = createPlannerTools(scope, this.timezone, this.botIds, execution);
      const toolDescription = JSON.stringify(
        Object.fromEntries(
          Object.entries(tools).map(([name, definition]) => [
            name,
            {
              description: definition.description,
              inputSchema: z.toJSONSchema(definition.inputSchema as z.ZodType, { io: "input" }),
            },
          ]),
        ),
      );
      const statusBlocks = [`当前角色状态：\n${await execution.readCharacter()}`];
      if (execution.otherChatsSummary) {
        statusBlocks.push(`其他群聊动态：\n${execution.otherChatsSummary}`);
      }
      this.appendBackground(statusBlocks.join("\n\n"));
      await saveContext();
      // SDK 的 onStepEnd 会吞掉回调异常，必须在下一步请求前和最终返回时显式传播。
      let stepSaveError: Error | undefined;
      // prepareStep 在每次请求前取快照，onStepEnd 使用对应的单步用量校准。
      let requestEstimate: number;
      const result = await generateText({
        model: flashModel,
        messages: this.history.flatMap((unit) => unit.messages),
        allowSystemInMessages: true,
        tools,
        maxRetries: 0,
        stopWhen: [
          stepCountIs(20),
          () => execution.waitSeconds !== undefined || execution.switchChannelId !== undefined,
        ],
        prepareStep: async () => {
          if (stepSaveError) {
            throw stepSaveError;
          }
          // 每一步都从已记录历史重建请求；压缩只改变上下文，不重放已执行工具。
          const previousSummary = this.context.summary;
          try {
            const messages = await this.context.prepare(this.history, [], {
              tools,
              toolDescription,
            });
            requestEstimate = estimateInputTokens(messages, toolDescription);
            return { messages };
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
        onToolExecutionStart: ({ toolCall }) => {
          logger.info("Planner 调用工具", {
            tool: toolCall.toolName,
            input: Object.fromEntries(
              Object.entries(toolCall.input as Record<string, unknown>).filter(
                ([key]) => !/(?:^id$|Id$|Ids$|_id$|-id$)/.test(key),
              ),
            ),
          });
        },
        onToolExecutionEnd: ({ toolCall, toolOutput, toolExecutionMs }) => {
          if (toolOutput.type === "tool-error") {
            logger.error("Planner 工具执行异常", {
              tool: toolCall.toolName,
              durationMs: toolExecutionMs,
              error: toolOutput.error,
            });
          }
        },
        onStepEnd: async ({ response, content, usage }) => {
          this.context.inputUsage = readInputTokenUsage(requestEstimate, usage);
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
            }
          }
        },
      });

      if (stepSaveError) {
        throw stepSaveError;
      }
      if (result.finishReason !== "stop" && result.finishReason !== "tool-calls") {
        throw new Error(`Planner 未完成：${result.finishReason}`);
      }
      if (
        execution.waitSeconds === undefined &&
        execution.switchChannelId === undefined &&
        result.finishReason !== "stop"
      ) {
        throw new Error("Planner 达到调用上限，尚未结束本轮");
      }
    } finally {
      reportAnalyticsEvent({
        eventName: "conversation.planner",
        eventData: {
          ...scope,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    }
  }

  async stop() {
    await this.context.stop();
    this.history = this.history.filter(
      (unit) => unit.sequence > this.context.summary.coveredThrough,
    );
  }
}

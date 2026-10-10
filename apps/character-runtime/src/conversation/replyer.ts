import { h } from "@satorijs/core";
import { reportAnalyticsEvent } from "@yuiju/shared/analytics/report-event";
import { load_config } from "@yuiju/shared/config/load";
import { measureInputBytes, readInputTokenUsage } from "@yuiju/shared/llm/context-usage";
import { chatModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type ModelMessage } from "ai";
import { type ContextSummary, ConversationContext } from "./context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "./message";
import type { ReplyInput } from "./tools";
import { collectReplyerGeneration } from "./training-data";

/** 每群独立的回复上下文；长期历史只保留真实交流，本轮补充上下文作为末尾临时输入。 */
export class Replyer {
  private context!: ConversationContext;
  /** 初始化时从合并默认值后的项目配置读取，与消息发生时间使用同一展示时区。 */
  private timezone!: string;

  constructor(
    private readonly scope: ConversationScope,
    private readonly collectTrainingData: boolean,
  ) {}

  async initialize(summary: Readonly<ContextSummary>) {
    const config = await load_config();
    this.timezone = config.app!.timezone!;
    const windowTokens = config.llm?.models?.chat?.context_window_tokens;
    if (!windowTokens) {
      throw new Error("群聊需要配置 chat.context_window_tokens");
    }
    const [persona, rules, characterPrompt, compressionPrompt] = await Promise.all([
      renderPrompt(`character.persona.${this.scope.characterId}`),
      renderPrompt("conversation.replyer"),
      renderPrompt(`conversation.replyer.${this.scope.characterId}`),
      renderPrompt("conversation.replyerCompression"),
    ]);
    this.context = new ConversationContext(
      {
        stage: "replyer",
        scope: this.scope,
        system: `${persona}\n\n${rules}\n\n${characterPrompt}`,
        compressionPrompt,
        model: chatModel,
        windowTokens,
      },
      summary,
    );
  }

  get summary() {
    return this.context.summary;
  }

  async replacePausedSummary(summary: ContextSummary): Promise<void> {
    await this.context.stop();
    this.context.replaceSummary(summary);
  }

  observe(history: ConversationMessage[]) {
    // loop 在没有执行中的轮次或一轮结束后调用，旁听也能推进压缩。
    this.context.applyCompression();
    this.context.maintain(this.historyUnits(history));
  }

  private historyUnits(history: ConversationMessage[]) {
    return history
      .filter((message) => message.sequence > this.context.summary.coveredThrough)
      .map((message) => ({
        sequence: message.sequence,
        messages: [
          { role: "user", content: renderMessage(message, this.timezone) } satisfies ModelMessage,
        ],
      }));
  }

  /**
   * historyThrough 之后的发送仅供本次生成参考，轮次结束后再和排队的新消息一起压缩。
   * 返回 null 表示模型明确选择本次不回复；空输出和格式错误仍抛出异常。
   */
  async reply(
    input: ReplyInput,
    history: ConversationMessage[],
    historyThrough: number,
    saveSummary: () => Promise<void>,
    characterContext: string,
  ): Promise<string | null> {
    const startedAt = performance.now();
    try {
      const previousSummary = this.context.summary;

      // 引用只使用当前可见的事实；不为一次回复同步读取 MongoDB。
      const quote = history.find(
        (message) => message.kind === "message" && message.id === input.quoteMessageId,
      );
      const embeddedQuote = history
        .flatMap((message) => (message.kind === "message" && message.quote ? [message.quote] : []))
        .find((item) => item.id === input.quoteMessageId && item.content !== undefined);
      if (input.quoteMessageId && !quote && !embeddedQuote) {
        throw new Error(`当前上下文没有引用原文：${input.quoteMessageId}`);
      }

      const mentioned = input.senderId
        ? history.find((message) => message.senderId === input.senderId)
        : undefined;

      // 当前任务始终放在历史之后，避免每次不同的补充上下文破坏稳定前缀。
      const taskLines = [`当前角色状态：\n${characterContext}`];
      if (input.replyContext !== undefined) {
        taskLines.push(`补充上下文：\n${input.replyContext}`);
      }
      if (quote) {
        taskLines.push(`本次引用：${renderMessage(quote, this.timezone)}`);
      }
      if (!quote && embeddedQuote) {
        taskLines.push(
          `本次引用：${h(
            "quote",
            {
              id: embeddedQuote.id,
              senderId: embeddedQuote.senderId,
              senderName: embeddedQuote.senderName,
            },
            h.parse(embeddedQuote.content!),
          ).toString()}`,
        );
      }
      if (input.senderId) {
        taskLines.push(
          `本次发送时，程序会在正文前附加对发送者 ${input.senderId}${mentioned?.senderName ? `（${mentioned.senderName}）` : ""} 的 @。你只写正文，无需重复 @ 或生成标签。`,
        );
      }
      const task: ModelMessage = { role: "user", content: taskLines.join("\n") };
      // 自己的新发送可能排在尚未处理的群消息之后，不能提前推进摘要覆盖序号。
      const messages = await this.context.prepare(
        this.historyUnits(history.filter((message) => message.sequence <= historyThrough)),
        [
          ...history
            .filter((message) => message.sequence > historyThrough)
            .map(
              (message): ModelMessage => ({
                role: "user",
                content: renderMessage(message, this.timezone),
              }),
            ),
          task,
        ],
      );

      if (previousSummary !== this.context.summary) await saveSummary();

      const requestBytes = measureInputBytes(messages);
      const result = await generateText({
        model: chatModel,
        messages,
        allowSystemInMessages: true,
        maxRetries: 0,
      });
      this.context.inputUsage = readInputTokenUsage(requestBytes, result.finalStep.usage);
      const text = result.text.trim();
      if (result.finishReason !== "stop" || !text) {
        throw new Error(`Replyer 未正常生成文字：${result.finishReason}`);
      }
      if (this.collectTrainingData) {
        // 先保留原始生成，包含主动沉默和待纠正的格式错误，供后续标注；不代表已发送。
        collectReplyerGeneration(
          this.scope,
          messages,
          text,
          result.finalStep.response.modelId,
          result.finalStep.reasoningText,
        );
      }
      if (text === "[[NO_REPLY]]") {
        logger.info("Replyer 本次不回复", {
          durationMs: Math.round(performance.now() - startedAt),
        });
        return null;
      }
      // 消息协议只用于输入和平台发送；模型生成的协议标签不能成为待发送正文。
      if (/<\/?(?:at|message|quote|poke|img|image|audio|video|file)(?=[\s/>])[^>]*>/i.test(text)) {
        throw new Error(
          "Replyer 输出包含消息协议标签，未发送；正文只能是普通文字，@ 和引用由程序附加",
        );
      }
      logger.info("Replyer 生成完成", {
        content: text,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return text;
    } finally {
      reportAnalyticsEvent({
        eventName: "conversation.replyer",
        eventData: {
          ...this.scope,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });
    }
  }

  async stop() {
    await this.context.stop();
  }
}

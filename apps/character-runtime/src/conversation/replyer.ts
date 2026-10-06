import { h } from "@satorijs/core";
import { load_config } from "@yuiju/shared/config/load";
import { chatModel } from "@yuiju/shared/llm/models";
import { logger } from "@yuiju/shared/logger/logger";
import { renderPrompt } from "@yuiju/shared/prompt/template";
import { generateText, type ModelMessage } from "ai";
import { type ContextSummary, ConversationContext } from "./context";
import { type ConversationMessage, type ConversationScope, renderMessage } from "./message";
import type { ReplyInput } from "./tools";

/** 每群独立的回复上下文；长期历史只保留真实交流，本轮回复意图作为末尾临时任务。 */
export class Replyer {
  private context!: ConversationContext;
  /** 初始化时从合并默认值后的项目配置读取，与消息发生时间使用同一展示时区。 */
  private timezone!: string;

  constructor(private readonly scope: ConversationScope) {}

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
        scope: this.scope,
        stage: "replyer",
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

  /** historyThrough 之后的发送仅供本次生成参考，轮次结束后再和排队的新消息一起压缩。 */
  async reply(
    input: ReplyInput,
    history: ConversationMessage[],
    historyThrough: number,
    saveSummary: () => Promise<void>,
    characterContext: string,
  ) {
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

    // 当前任务始终放在历史之后，避免每次不同的回复意图破坏稳定前缀。
    const taskLines = [`本次交流意图：${input.replyContext}`];
    taskLines.push(`当前角色状态：\n${characterContext}`);
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
        `本次 @ 对象：${h("at", { id: input.senderId, name: mentioned?.senderName })}`,
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

    const startedAt = Date.now();
    const result = await generateText({
      model: chatModel,
      messages,
      allowSystemInMessages: true,
      maxRetries: 0,
    });
    logger.info("聊天文字生成完成", {
      ...this.scope,
      stage: "replyer",
      durationMs: Date.now() - startedAt,
      usage: result.usage,
    });
    if (result.finishReason !== "stop" || !result.text.trim()) {
      throw new Error(`Replyer 未正常生成文字：${result.finishReason}`);
    }
    return result.text.trim();
  }

  async stop() {
    await this.context.stop();
  }
}
